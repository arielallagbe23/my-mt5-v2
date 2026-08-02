"""
positions.py — Surveille les positions et ordres différés à chaque tour de
boucle :
  - check_order_fills : détecte quand un ordre différé se transforme en
    position ouverte (déclenché) ;
  - check_tp_progress : notifie la progression d'une position vers son TP
    (50% / 75% / 95% / TP atteint) ;
  - check_trailing_stop : déplace le SL par paliers (BE à 50%, 25% à 75%,
    50% à 95%), à la bougie suivante du timeframe concerné.

Ces trois fonctions ne concernent que les positions issues d'une tâche H1 ou
H4 (le M15 est exclu — trop de bruit).

Tourne en continu, mais ne compare qu'en mémoire (aucune lecture/écriture
Firestore en continu) — seuls les appels à l'API de notification et, pour le
trailing stop, à MT5 order_send() ont lieu, et seulement quand un événement
réel est détecté. La seule exception est un Firestore.get() ponctuel, une
seule fois par position (mis en cache ensuite), pour retrouver le timeframe
de la tâche à l'origine d'une position.
"""

from datetime import datetime, timezone

from config import DRY_RUN, PRICE_SYMBOL
from mt5_client import ensure_mt5
from notify import notify

POSITION_TYPE_NAMES = {0: "Buy", 1: "Sell"}
PROGRESS_THRESHOLDS = [50, 75, 95, 100]
ELIGIBLE_TIMEFRAMES = {"H1", "H4"}  # le M15 est exclu — trop de bruit

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


# ticket -> timeframe de la tâche d'origine ("H1"/"H4"/autre), ou None si
# introuvable/non éligible. Rempli une seule fois par position (via un
# Firestore.get() ponctuel), puis réutilisé à chaque tour.
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


def check_tp_progress(db):
    """Notifie la progression d'une position ouverte vers son TP (50% / 75%
    / 95% / TP atteint), pour les positions issues d'une tâche H1 ou H4
    uniquement. Chaque seuil n'est notifié qu'une fois par position.

    Note : le seuil 100% (TP atteint) peut ne jamais se déclencher depuis
    cette fonction en pratique — dès que le TP est vraiment touché, MT5 clôt
    la position automatiquement, donc elle risque de disparaître de
    positions_get() avant même qu'on la voie à ~100%. Une détection fiable
    de "position fermée au TP" nécessiterait de regarder l'historique des
    deals plutôt que les positions ouvertes — pas fait ici, à ajouter si ce
    seuil s'avère peu fiable en pratique.
    """
    m = ensure_mt5()
    if m is None:
        return

    positions = m.positions_get(symbol=PRICE_SYMBOL) or ()

    for pos in positions:
        ticket = pos.ticket
        tp = pos.tp
        if not tp:
            continue  # pas de TP défini sur cette position, rien à mesurer

        if ticket not in _position_timeframe_cache:
            _position_timeframe_cache[ticket] = _task_timeframe(db, pos.comment)
        if _position_timeframe_cache[ticket] not in ELIGIBLE_TIMEFRAMES:
            continue

        entry = pos.price_open
        current = pos.price_current
        total_distance = abs(tp - entry)
        if not total_distance:
            continue

        progress = abs(current - entry) / total_distance * 100
        already_notified = _notified_thresholds.setdefault(ticket, set())

        for threshold in PROGRESS_THRESHOLDS:
            if progress >= threshold and threshold not in already_notified:
                side = POSITION_TYPE_NAMES.get(pos.type, str(pos.type))
                label = "TP atteint" if threshold == 100 else f"{threshold}% du chemin vers le TP"
                notify(
                    f"mymt5 — {label}",
                    f"{pos.symbol} {side} (ticket {ticket}) : {current:.3f}, entrée {entry:.3f}, TP {tp:.3f}",
                )
                already_notified.add(threshold)
                print(f"[TP] ticket {ticket} : {label} (prix {current:.3f})")

    # Nettoyage : une position fermée (SL, TP, manuelle...) ne doit pas rester
    # indéfiniment en mémoire.
    current_tickets = {p.ticket for p in positions}
    for cache in (_position_timeframe_cache, _notified_thresholds):
        for ticket in list(cache):
            if ticket not in current_tickets:
                del cache[ticket]


# Palier de progression -> % du chemin entrée→TP où placer le SL une fois la
# bougie suivante atteinte. 50% de progression -> SL à BE (0%) ; 75% -> 25% ;
# 95% -> 50%. Cette liste est parcourue du plus haut palier au plus bas pour
# ne retenir que le palier le plus avancé atteint dans la bougie courante.
SL_STAGES = [(95, 50), (75, 25), (50, 0)]

_TF_CONSTANTS = {"H1": "TIMEFRAME_H1", "H4": "TIMEFRAME_H4"}

# ticket -> (target_pct, candle_time) : palier en attente d'application à la
# bougie suivante, et l'heure d'ouverture de la bougie au moment où il a été
# fixé (pour détecter qu'une nouvelle bougie a démarré depuis).
_sl_pending = {}

# ticket -> target_pct déjà appliqué (le plus avancé) : évite de repasser
# deux fois le même palier ou de reculer le SL.
_sl_applied = {}


def _current_candle_time(m, symbol, timeframe):
    tf_constant = getattr(m, _TF_CONSTANTS[timeframe])
    rates = m.copy_rates_from(symbol, tf_constant, datetime.now(timezone.utc), 1)
    if rates is None or len(rates) == 0:
        return None
    return int(rates[0]["time"])


def check_trailing_stop(db):
    """Déplace le SL par paliers, à la bougie suivante du timeframe de la
    tâche d'origine (H1/H4 uniquement) :
      - 50% de progression atteints -> SL à BE (prix d'entrée)
      - 75% -> SL à 25% du chemin entrée→TP
      - 95% -> SL à 50% du chemin entrée→TP
    Le mouvement n'est jamais instantané : on attend le début de la bougie
    suivante après avoir détecté le palier. Si plusieurs paliers sont
    atteints dans la même bougie (ex: 50% et 75% d'un coup), seul le plus
    avancé (75% -> 25%) est appliqué à la bougie suivante.
    """
    m = ensure_mt5()
    if m is None:
        return

    positions = m.positions_get(symbol=PRICE_SYMBOL) or ()

    for pos in positions:
        ticket = pos.ticket
        tp = pos.tp
        if not tp:
            continue

        if ticket not in _position_timeframe_cache:
            _position_timeframe_cache[ticket] = _task_timeframe(db, pos.comment)
        timeframe = _position_timeframe_cache[ticket]
        if timeframe not in ELIGIBLE_TIMEFRAMES:
            continue

        entry = pos.price_open
        current = pos.price_current
        total_distance = abs(tp - entry)
        if not total_distance:
            continue

        progress = abs(current - entry) / total_distance * 100
        applied = _sl_applied.get(ticket, -1)

        # --- 1. Le palier le plus avancé atteint devient (ou reste) en attente ---
        for threshold, target_pct in SL_STAGES:
            if progress >= threshold and target_pct > applied:
                candle_time = _current_candle_time(m, pos.symbol, timeframe)
                if candle_time is None:
                    break
                pending = _sl_pending.get(ticket)
                if pending is None or target_pct > pending[0]:
                    _sl_pending[ticket] = (target_pct, candle_time)
                break

        # --- 2. Application si une nouvelle bougie a démarré depuis la mise en attente ---
        pending = _sl_pending.get(ticket)
        if pending is None:
            continue
        target_pct, pending_since = pending

        candle_time = _current_candle_time(m, pos.symbol, timeframe)
        if candle_time is None or candle_time <= pending_since:
            continue  # toujours dans la même bougie, on attend

        new_sl = entry + (tp - entry) * (target_pct / 100)
        side = POSITION_TYPE_NAMES.get(pos.type, str(pos.type))
        label = "BE" if target_pct == 0 else f"{target_pct}%"

        if DRY_RUN:
            # Jamais d'order_send réel en DRY_RUN — on notifie ce qui aurait
            # été fait et on marque le palier comme "appliqué" pour ne pas
            # renotifier à chaque tour.
            notify(
                f"mymt5 — [DRY-RUN] SL aurait été déplacé ({label})",
                f"{pos.symbol} {side} (ticket {ticket}) : nouveau SL {new_sl:.3f}",
            )
            print(f"[TRAILING] (dry-run) ticket {ticket} : SL aurait été déplacé à {label} ({new_sl:.3f})")
            _sl_applied[ticket] = target_pct
            del _sl_pending[ticket]
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
            continue  # on retentera au prochain tour, pending reste en place

        _sl_applied[ticket] = target_pct
        del _sl_pending[ticket]

        notify(
            f"mymt5 — SL déplacé ({label})",
            f"{pos.symbol} {side} (ticket {ticket}) : nouveau SL {new_sl:.3f}",
        )
        print(f"[TRAILING] ticket {ticket} : SL déplacé à {label} ({new_sl:.3f})")

    # Nettoyage : une position fermée ne doit pas rester en mémoire.
    current_tickets = {p.ticket for p in positions}
    for cache in (_sl_pending, _sl_applied):
        for ticket in list(cache):
            if ticket not in current_tickets:
                del cache[ticket]
