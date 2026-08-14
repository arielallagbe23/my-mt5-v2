"""
untracked_positions.py — Détecte une position ouverte hors mymt5 (ouverte
manuellement ou par un autre EA) et notifie une seule fois, pour inviter à
activer son suivi (trailing stop + progression TP) depuis l'app.
"""

from config import PRICE_SYMBOL
from mt5_client import ensure_mt5
from notify import notify
from position_shared import POSITION_TYPE_NAMES

# État dédié à ce module — dernier ensemble de tickets de positions ouvertes
# connu, pour ne notifier qu'à la toute première apparition d'une position.
_last_known_position_tickets = None


def check_untracked_positions(db):
    """Notifie dès qu'une position ouverte hors mymt5 (comment MT5 sans
    préfixe "task-", donc ouverte manuellement ou par un autre EA) apparaît —
    pour inviter à activer son suivi depuis l'accueil si souhaité. Ne
    notifie qu'une fois par position, à sa première apparition (pas à chaque
    tour tant qu'elle reste ouverte)."""
    global _last_known_position_tickets

    m = ensure_mt5()
    if m is None:
        return

    positions = m.positions_get(symbol=PRICE_SYMBOL) or ()
    current_tickets = {p.ticket for p in positions}

    if _last_known_position_tickets is None:
        # Premier tour : on mémorise l'état sans notifier — les positions
        # déjà ouvertes avant le démarrage du script ne sont pas "nouvelles".
        _last_known_position_tickets = current_tickets
        return

    new_tickets = current_tickets - _last_known_position_tickets
    if new_tickets:
        positions_by_ticket = {p.ticket: p for p in positions}
        for ticket in new_tickets:
            pos = positions_by_ticket.get(ticket)
            if pos is None or (pos.comment or "").startswith("task-"):
                continue  # gérée par mymt5 — check_order_fills s'en charge déjà

            side = POSITION_TYPE_NAMES.get(pos.type, str(pos.type))
            notify(
                "mymt5 — position hors mymt5 détectée",
                f"{pos.symbol} {side} @ {pos.price_open} (ticket {ticket}) — "
                "active le suivi depuis l'accueil si tu veux le trailing stop/la progression TP.",
            )
            print(f"[UNTRACKED] position hors mymt5 détectée : ticket {ticket}")

    _last_known_position_tickets = current_tickets
