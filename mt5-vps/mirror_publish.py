"""
mirror_publish.py — Publie en continu l'état des positions ouvertes ET des
ordres différés (pas encore déclenchés) USDJPY sur le compte principal
(tous, quelle que soit leur origine — tâche ou manuelle) dans Firestore,
pour que mirror_follower.py (compte suppléant, process séparé connecté à
un deuxième terminal MT5) puisse les reproduire dès leur pose, pas
seulement une fois déclenchés.

Publie aussi le login live à chaque tour (vps_status/{VPS_ID}.login) — ce
champ n'était sinon rafraîchi que sur demande ponctuelle de l'app
(status_request), et pouvait donc rester périmé un moment après un
changement de terminal/compte. mirror_follower.py en dépend pour retrouver
account_size du compte principal (voir tasks.py._account_size pour le même
problème côté tâches, réglé différemment là-bas via le login live de sa
propre connexion MT5 — le suppléant, lui, n'a que Firestore).

Seule responsabilité de ce module : publier l'état tel quel, à chaque tour
de boucle. Aucune décision, aucun calcul de risque — ça, c'est le rôle du
suppléant lui-même, sur SES propres paramètres.
"""

import time

from config import PRICE_SYMBOL, VPS_ID
from mt5_client import ensure_mt5

# Dernier ensemble de tickets publiés — pour supprimer de Firestore ceux qui
# ont fermé/disparu depuis (le suppléant s'en sert pour détecter ça).
_last_published_position_tickets = None
_last_published_order_tickets = None


def publish_master_positions(db):
    m = ensure_mt5()
    if m is None:
        return

    ai = m.account_info()
    if ai is not None:
        db.collection("vps_status").document(VPS_ID).set(
            {"login": ai.login, "online": True, "ts": int(time.time())}, merge=True
        )

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

    global _last_published_position_tickets
    if _last_published_position_tickets is not None:
        closed_tickets = _last_published_position_tickets - current_tickets
        for ticket in closed_tickets:
            db.collection("mirror_positions").document(str(ticket)).delete()

    _last_published_position_tickets = current_tickets


def publish_master_orders(db):
    """Ordres différés (Buy/Sell Limit posés par tasks.py ou à la main) pas
    encore déclenchés — collection séparée de mirror_positions, même si en
    mode Hedging le ticket d'ordre devient le ticket de position une fois
    déclenché (mirror_follower.py s'appuie là-dessus pour ne jamais
    miroiter deux fois la même chose)."""
    m = ensure_mt5()
    if m is None:
        return

    orders = m.orders_get(symbol=PRICE_SYMBOL) or ()
    current_tickets = set()

    for order in orders:
        ticket = order.ticket
        current_tickets.add(ticket)
        db.collection("mirror_orders").document(str(ticket)).set({
            "ticket": ticket,
            "symbol": order.symbol,
            "order_type": order.type,  # constante MT5 brute (BUY_LIMIT, SELL_LIMIT...), transmise telle quelle
            "entry": order.price_open,
            "sl": order.sl,
            "tp": order.tp,
            "volume": order.volume_current,
            "comment": order.comment,
            "updated_at": int(time.time()),
        })

    global _last_published_order_tickets
    if _last_published_order_tickets is not None:
        closed_tickets = _last_published_order_tickets - current_tickets
        for ticket in closed_tickets:
            db.collection("mirror_orders").document(str(ticket)).delete()

    _last_published_order_tickets = current_tickets
