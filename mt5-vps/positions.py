"""
positions.py — Surveille les ordres différés à chaque tour de boucle et
détecte quand l'un d'eux se transforme en position ouverte (déclenché), pour
envoyer une notification. Tourne en continu comme check_due_tasks, mais ne
compare qu'en mémoire (aucune lecture Firestore) et n'écrit jamais dans
Firestore — seul un appel à l'API de notification a lieu, et seulement quand
un déclenchement est détecté.
"""

from config import PRICE_SYMBOL
from mt5_client import ensure_mt5
from notify import notify

POSITION_TYPE_NAMES = {0: "Buy", 1: "Sell"}

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
