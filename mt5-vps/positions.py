"""
positions.py — Surveille les positions et ordres différés à chaque tour de
boucle :
  - check_order_fills : détecte quand un ordre différé se transforme en
    position ouverte (déclenché) ;
  - check_tp_progress : notifie la progression d'une position vers son TP
    (50% / 75% / 95% / TP atteint), uniquement pour les positions issues
    d'une tâche H1 ou H4.

Tourne en continu, mais ne compare qu'en mémoire (aucune lecture/écriture
Firestore en continu) — seuls les appels à l'API de notification ont lieu,
et seulement quand un événement réel est détecté. La seule exception est un
Firestore.get() ponctuel, une seule fois par position (mis en cache ensuite),
pour retrouver le timeframe de la tâche à l'origine d'une position.
"""

from config import PRICE_SYMBOL
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
