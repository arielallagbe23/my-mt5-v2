"""
order_fills.py — Détecte quand un ordre différé se transforme en position
ouverte (déclenché), notifie, et active automatiquement le suivi trailing
stop dessus si rien ne le suit déjà. Seule responsabilité de ce module :
suivre le passage ordre -> position, à chaque tour de boucle.
"""

import time

from config import PRICE_SYMBOL
from mt5_client import ensure_mt5
from notify import notify
from position_shared import POSITION_TYPE_NAMES, resolve_timeframe

# Timeframe appliqué automatiquement à une position tout juste déclenchée
# quand rien ne la suit déjà (ni une tâche — comment "task-{id}" — ni une
# activation manuelle antérieure via managed_positions) — même valeur par
# défaut que le bouton "Activer" côté app (OrdersPage.jsx).
AUTO_TRAILING_TIMEFRAME = "H1"

# État en mémoire (pas en Firestore, pour ne rien coûter en lecture/écriture)
# du dernier ensemble de tickets d'ordres différés connu. None = pas encore
# initialisé (premier tour depuis le démarrage du script).
_last_pending_tickets = None


def check_order_fills(db):
    """Compare les ordres différés actuels à ceux du tour précédent. Un
    ticket qui disparaît des ordres différés ET apparaît dans les positions
    ouvertes vient d'être déclenché -> notification. S'il disparaît sans
    devenir une position, c'est qu'il a été annulé/a expiré côté MT5 -> pas
    de notification (ce n'est pas ce qui nous intéresse ici)."""
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

            # Suivi trailing stop automatique : si cette position n'est déjà
            # suivie ni par une tâche (comment "task-{id}") ni par une
            # activation manuelle antérieure, on l'active nous-mêmes — plus
            # besoin de cliquer "Activer" après coup pour un ordre différé
            # (manuel ou programmé) qui vient de se déclencher.
            if resolve_timeframe(db, ticket, pos.comment) is None:
                db.collection("managed_positions").document(str(ticket)).set({
                    "timeframe": AUTO_TRAILING_TIMEFRAME,
                    "activatedAt": int(time.time() * 1000),
                })
                print(f"[FILL] ticket {ticket} : suivi trailing stop activé automatiquement ({AUTO_TRAILING_TIMEFRAME})")

    _last_pending_tickets = current_tickets
