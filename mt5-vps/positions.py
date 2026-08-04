"""
positions.py — Surveille les positions et ordres différés :
  - check_order_fills : détecte quand un ordre différé se transforme en
    position ouverte (déclenché) — à chaque tour de boucle ;
  - check_tp_progress : notifie la progression d'une position vers son TP
    (50% / 75% / 95% / TP atteint) — vérifié toutes les 15 minutes, à partir
    du pic (high/low) de la dernière bougie clôturée du timeframe concerné ;
  - check_trailing_stop : déplace le SL par paliers (BE à 50%, 25% à 75%,
    50% à 95%), à partir du même pic — vérifié une seule fois par nouvelle
    bougie H1/H4.

Ces trois fonctions ne concernent que les positions issues d'une tâche H1 ou
H4, OU d'une position quelconque (ouverte manuellement, par un autre EA...)
dont le suivi a été activé manuellement depuis l'app avec un timeframe H1/H4
(managed_positions/{ticket}) — le M15 est exclu — trop de bruit.

Tourne en continu, mais ne compare qu'en mémoire (aucune lecture/écriture
Firestore en continu) — seuls les appels à l'API de notification et, pour le
trailing stop, à MT5 order_send() ont lieu, et seulement quand un événement
réel est détecté. La seule exception est un Firestore.get() ponctuel pour
retrouver le timeframe éligible d'une position (tâche d'origine, sinon
activation manuelle) : mis en cache dès qu'un timeframe éligible est trouvé,
sinon re-tenté au prochain contrôle (peu coûteux, ces contrôles sont déjà
espacés dans le temps).
"""

from datetime import datetime, timedelta, timezone

from config import DRY_RUN, PRICE_SYMBOL
from mt5_client import ensure_mt5
from notify import notify

POSITION_TYPE_NAMES = {0: "Buy", 1: "Sell"}
PROGRESS_THRESHOLDS = [50, 75, 95, 100]
ELIGIBLE_TIMEFRAMES = {"H1", "H4"}  # le M15 est exclu — trop de bruit
_TF_CONSTANTS = {"H1": "TIMEFRAME_H1", "H4": "TIMEFRAME_H4"}

# État en mémoire (pas en Firestore, pour ne rien coûter en lecture/écriture)
# du dernier ensemble de tickets d'ordres différés connu. None = pas encore
# initialisé (premier tour depuis le démarrage du script).
_last_pending_tickets = None


def check_order_fills(db):
    """Compare les ordres différés actuels à ceux du tour précédent. Un ticket
    qui disparaît des ordres différés ET apparaît dans les positions ouvertes
    vient d'être déclenché -> notification. S'il disparaît sans devenir une
    position, c'est qu'il a été annulé/a expiré côté MT5 -> pas de notification
    (ce n'est pas ce qui nous intéresse ici)."""
    global _last_pending_tickets

    m = ensure_mt5()
    if m is None:
        return

    orders = m.orders_get(symbol=PRICE_SYMBOL) or ()
    current_tickets = {o.ticket for o in orders}

    if _last_pending_tickets is None:
        # Premier tour : on mémorise l'état sans notifier, pour ne pas
        # envoyer une rafale de notifications sur des ordres qui existaient
        # déjà avant que le script démarre.
        _last_pending_tickets = current_tickets
        return

    filled_tickets = _last_pending_tickets - current_tickets
    if filled_tickets:
        positions = m.positions_get(symbol=PRICE_SYMBOL) or ()
        positions_by_ticket = {p.ticket: p for p in positions}

        for ticket in filled_tickets:
            pos = positions_by_ticket.get(ticket)
            if pos is None:
                continue  # annulé/expiré, pas déclenché — rien à notifier

            side = POSITION_TYPE_NAMES.get(pos.type, str(pos.type))
            notify(
                "mymt5 — ordre déclenché",
                f"{pos.symbol} {side} @ {pos.price_open} vient de s'ouvrir (ticket {ticket})",
            )
            print(f"[FILL] ticket {ticket} déclenché : {pos.symbol} {side} @ {pos.price_open}")

    _last_pending_tickets = current_tickets


# ticket -> timeframe éligible ("H1"/"H4"), via la tâche d'origine ou une
# activation manuelle. N'est rempli QUE quand un timeframe éligible a été
# trouvé (voir _resolve_timeframe) — jamais mis en cache à None/non-éligible,
# pour qu'une activation manuelle faite après coup soit prise en compte.
_position_timeframe_cache = {}

# ticket -> ensemble des seuils déjà notifiés pour cette position.
_notified_thresholds = {}


def _task_timeframe(db, comment):
    """Retrouve le timeframe de la tâche à l'origine d'une position via son
    commentaire MT5 (format "task-{taskId}", posé par tasks.py à la création
    de l'ordre). Retourne None si le commentaire est absent/inattendu ou si
    la tâche n'existe plus."""
    if not comment or not comment.startswith("task-"):
        return None
    task_id = comment[len("task-") :]
    doc = db.collection("tasks").document(task_id).get()
    if not doc.exists:
        return None
    return doc.to_dict().get("timeframe")


def _manual_timeframe(db, ticket):
    """Timeframe activé manuellement depuis l'app pour une position qui n'a
    PAS été ouverte par une tâche mymt5 (managed_positions/{ticket}, écrit
    par le bouton "Activer le suivi" côté app)."""
    doc = db.collection("managed_positions").document(str(ticket)).get()
    if not doc.exists:
        return None
    return doc.to_dict().get("timeframe")


def _resolve_timeframe(db, ticket, comment):
    """Timeframe éligible (H1/H4) d'une position, via sa tâche d'origine en
    priorité, sinon via une activation manuelle. Mis en cache UNIQUEMENT
    quand un timeframe éligible est trouvé : une position sans timeframe
    éligible reste non mise en cache, pour qu'une activation manuelle faite
    après coup soit prise en compte au prochain contrôle (toutes les 15 min
    pour check_tp_progress, à la bougie suivante pour check_trailing_stop —
    donc peu coûteux de re-vérifier)."""
    if ticket in _position_timeframe_cache:
        return _position_timeframe_cache[ticket]
    timeframe = _task_timeframe(db, comment) or _manual_timeframe(db, ticket)
    if timeframe in ELIGIBLE_TIMEFRAMES:
        _position_timeframe_cache[ticket] = timeframe
    return timeframe


def _candles_current_and_previous(m, symbol, timeframe):
    """Renvoie (bougie précédente, bougie courante) pour ce timeframe, ou
    (None, None) si indisponible. Position 0 = courante (en formation),
    position 1 = celle qui vient de se terminer. Partagée par
    check_tp_progress et check_trailing_stop."""
    tf_constant = getattr(m, _TF_CONSTANTS[timeframe])
    rates = m.copy_rates_from_pos(symbol, tf_constant, 0, 2)
    if rates is None or len(rates) < 2:
        return None, None
    return rates[0], rates[-1]  # ordre chronologique : [précédente, courante]


def _candle_peak(pos, previous_bar):
    """Pic atteint par la bougie précédente dans le sens favorable à la
    position : high pour un achat, low pour une vente."""
    is_buy = pos.type == 0  # POSITION_TYPE_BUY
    return float(previous_bar["high"]) if is_buy else float(previous_bar["low"])


PROGRESS_CHECK_INTERVAL_SECONDS = 15 * 60  # 15 minutes
_last_progress_check = None


def check_tp_progress(db):
    """Notifie la progression d'une position ouverte vers son TP (50% / 75%
    / 95% / TP atteint), pour les positions issues d'une tâche H1 ou H4
    uniquement. Vérifié toutes les 15 minutes (une simple minuterie, pas liée
    à une détection de nouvelle bougie) — à partir du pic (high/low) de la
    dernière bougie clôturée du timeframe de la position, pas du prix live.
    Chaque seuil n'est notifié qu'une fois par position.

    Note : le seuil 100% (TP atteint) peut ne jamais se déclencher depuis
    cette fonction en pratique — dès que le TP est vraiment touché, MT5 clôt
    la position automatiquement, donc elle risque de disparaître de
    positions_get() avant même qu'on la voie à ~100%. Une détection fiable
    de "position fermée au TP" nécessiterait de regarder l'historique des
    deals plutôt que les positions ouvertes — pas fait ici, à ajouter si ce
    seuil s'avère peu fiable en pratique.
    """
    global _last_progress_check
    now_utc = datetime.now(timezone.utc)
    if (
        _last_progress_check is not None
        and (now_utc - _last_progress_check).total_seconds() < PROGRESS_CHECK_INTERVAL_SECONDS
    ):
        return
    _last_progress_check = now_utc

    m = ensure_mt5()
    if m is None:
        return

    positions = m.positions_get(symbol=PRICE_SYMBOL) or ()

    for pos in positions:
        ticket = pos.ticket
        tp = pos.tp
        if not tp:
            continue  # pas de TP défini sur cette position, rien à mesurer

        timeframe = _resolve_timeframe(db, ticket, pos.comment)
        if timeframe not in ELIGIBLE_TIMEFRAMES:
            continue

        previous_bar, _ = _candles_current_and_previous(m, pos.symbol, timeframe)
        if previous_bar is None:
            continue

        entry = pos.price_open
        peak = _candle_peak(pos, previous_bar)
        total_distance = abs(tp - entry)
        if not total_distance:
            continue

        progress = abs(peak - entry) / total_distance * 100
        already_notified = _notified_thresholds.setdefault(ticket, set())

        for threshold in PROGRESS_THRESHOLDS:
            if progress >= threshold and threshold not in already_notified:
                side = POSITION_TYPE_NAMES.get(pos.type, str(pos.type))
                label = "TP atteint" if threshold == 100 else f"{threshold}% du chemin vers le TP"
                notify(
                    f"mymt5 — {label}",
                    f"{pos.symbol} {side} (ticket {ticket}) : pic {peak:.3f}, entrée {entry:.3f}, TP {tp:.3f}",
                )
                already_notified.add(threshold)
                print(f"[TP] ticket {ticket} : {label} (pic {peak:.3f})")

    # Nettoyage : une position fermée (SL, TP, manuelle...) ne doit pas rester
    # indéfiniment en mémoire.
    current_tickets = {p.ticket for p in positions}
    for cache in (_position_timeframe_cache, _notified_thresholds):
        for ticket in list(cache):
            if ticket not in current_tickets:
                del cache[ticket]


# Palier de progression -> % du chemin entrée→TP où placer le SL. 50% de
# progression -> SL à BE (0%) ; 75% -> 25% ; 95% -> 50%. Parcourue du plus
# haut palier au plus bas pour ne retenir que le plus avancé atteint.
SL_STAGES = [(95, 50), (75, 25), (50, 0)]

SAFETY_DELAY_SECONDS = 2  # attendre un peu après l'ouverture d'une nouvelle bougie avant de la lire

# timeframe -> candle_time de la dernière bougie déjà traitée pour ce
# timeframe (H1 ou H4) — permet de ne travailler qu'une fois par bougie.
_last_processed_candle_time = {}

# ticket -> target_pct déjà appliqué (le plus avancé) : évite de repasser
# deux fois le même palier ou de reculer le SL.
_sl_applied = {}


def check_trailing_stop(db):
    """Déplace le SL par paliers (BE à 50%, 25% à 75%, 50% à 95%), en se
    basant sur le PIC atteint par la bougie qui vient de se terminer — le
    high pour un achat, le low pour une vente — pas le prix live en continu.

    Ne travaille qu'UNE FOIS par nouvelle bougie H1/H4 (pas à chaque tour de
    boucle, ~10s) : on détecte qu'une nouvelle bougie vient d'apparaître,
    on attend un petit délai de sécurité (2s) après son ouverture pour être
    sûr que la précédente est bien finalisée côté MT5, puis on lit son
    pic. Comme le contrôle n'a lieu qu'une fois par bougie, un palier
    franchi est automatiquement appliqué "à la bougie suivante" par
    construction — plus besoin du mécanisme séparé "en attente" qu'il y
    avait avant.

    Limite acceptée : si order_send échoue, on ne retente qu'à la bougie
    suivante (pas au tour suivant comme avant) — plus simple, et un échec
    isolé n'est pas critique puisque le SL en place reste valide en
    attendant.
    """
    m = ensure_mt5()
    if m is None:
        return

    now_utc = datetime.now(timezone.utc)
    positions_fetched = None  # ne sert qu'au nettoyage en fin de fonction

    for timeframe in ELIGIBLE_TIMEFRAMES:
        previous_bar, current_bar = _candles_current_and_previous(m, PRICE_SYMBOL, timeframe)
        if previous_bar is None:
            continue

        current_time = int(current_bar["time"])
        if _last_processed_candle_time.get(timeframe) == current_time:
            continue  # déjà traité pour cette bougie

        candle_open = datetime.fromtimestamp(current_time, tz=timezone.utc)
        if now_utc < candle_open + timedelta(seconds=SAFETY_DELAY_SECONDS):
            continue  # trop tôt, on retente au tour suivant

        _last_processed_candle_time[timeframe] = current_time

        positions_fetched = m.positions_get(symbol=PRICE_SYMBOL) or ()
        for pos in positions_fetched:
            ticket = pos.ticket
            tp = pos.tp
            if not tp:
                continue

            if _resolve_timeframe(db, ticket, pos.comment) != timeframe:
                continue

            entry = pos.price_open
            peak = _candle_peak(pos, previous_bar)

            total_distance = abs(tp - entry)
            if not total_distance:
                continue

            progress = abs(peak - entry) / total_distance * 100
            applied = _sl_applied.get(ticket, -1)

            target_pct = None
            for threshold, pct in SL_STAGES:
                if progress >= threshold and pct > applied:
                    target_pct = pct
                    break
            if target_pct is None:
                continue

            new_sl = entry + (tp - entry) * (target_pct / 100)
            side = POSITION_TYPE_NAMES.get(pos.type, str(pos.type))
            label = "BE" if target_pct == 0 else f"{target_pct}%"

            if DRY_RUN:
                # Jamais d'order_send réel en DRY_RUN — on notifie ce qui
                # aurait été fait et on marque le palier comme "appliqué"
                # pour ne pas renotifier à la prochaine bougie.
                notify(
                    f"mymt5 — [DRY-RUN] SL aurait été déplacé ({label})",
                    f"{pos.symbol} {side} (ticket {ticket}) : nouveau SL {new_sl:.3f} (pic bougie {peak:.3f})",
                )
                print(f"[TRAILING] (dry-run) ticket {ticket} : SL aurait été déplacé à {label} ({new_sl:.3f})")
                _sl_applied[ticket] = target_pct
                continue

            res = m.order_send({
                "action": m.TRADE_ACTION_SLTP,
                "position": ticket,
                "symbol": pos.symbol,
                "sl": new_sl,
                "tp": tp,
            })

            if res is None or res.retcode != m.TRADE_RETCODE_DONE:
                error = str(m.last_error()) if res is None else res.comment
                print(f"[TRAILING] ticket {ticket} : échec déplacement SL à {new_sl:.3f} : {error}")
                continue  # retenté à la prochaine bougie, pas ce tour-ci

            _sl_applied[ticket] = target_pct
            notify(
                f"mymt5 — SL déplacé ({label})",
                f"{pos.symbol} {side} (ticket {ticket}) : nouveau SL {new_sl:.3f} (pic bougie {peak:.3f})",
            )
            print(f"[TRAILING] ticket {ticket} : SL déplacé à {label} ({new_sl:.3f})")

    # Nettoyage : une position fermée ne doit pas rester en mémoire. Seulement
    # si on a effectivement récupéré les positions ce tour-ci (pas d'appel
    # MT5 supplémentaire sinon).
    if positions_fetched is not None:
        current_tickets = {p.ticket for p in positions_fetched}
        for ticket in list(_sl_applied):
            if ticket not in current_tickets:
                del _sl_applied[ticket]
