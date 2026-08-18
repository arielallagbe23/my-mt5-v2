"""
mirror_publish.py — Publie en continu l'état des positions USDJPY ouvertes
sur le compte principal (toutes, quelle que soit leur origine — tâche ou
manuelle) dans Firestore, pour que mirror_follower.py (compte suppléant,
process séparé connecté à un deuxième terminal MT5) puisse les reproduire.

Seule responsabilité de ce module : publier l'état tel quel, à chaque tour
de boucle. Aucune décision, aucun calcul de risque — ça, c'est le rôle du
suppléant lui-même, sur SES propres paramètres.
"""

import time

from config import PRICE_SYMBOL
from mt5_client import ensure_mt5

# Dernier ensemble de tickets publiés — pour supprimer de Firestore ceux qui
# ont fermé depuis (le suppléant s'en sert pour détecter une clôture).
_last_published_tickets = None


def publish_master_positions(db):
    m = ensure_mt5()
    if m is None:
        return

    positions = m.positions_get(symbol=PRICE_SYMBOL) or ()
    current_tickets = set()

    for pos in positions:
        ticket = pos.ticket
        current_tickets.add(ticket)
        db.collection("mirror_positions").document(str(ticket)).set({
            "ticket": ticket,
            "symbol": pos.symbol,
            "type": pos.type,  # 0 = Buy, 1 = Sell (brut — le suppléant fait le mapping)
            "entry": pos.price_open,
            "sl": pos.sl,
            "tp": pos.tp,
            "volume": pos.volume,
            "comment": pos.comment,
            "updated_at": int(time.time()),
        })

    global _last_published_tickets
    if _last_published_tickets is not None:
        closed_tickets = _last_published_tickets - current_tickets
        for ticket in closed_tickets:
            db.collection("mirror_positions").document(str(ticket)).delete()

    _last_published_tickets = current_tickets
