"""
mirror_publish.py — Publie en continu l'état des positions ouvertes ET des
ordres différés (pas encore déclenchés) USDJPY sur le compte principal
(tous, quelle que soit leur origine — tâche ou manuelle) dans Firestore,
pour que mirror_follower.py (compte suppléant, process séparé connecté à
un deuxième terminal MT5) puisse les reproduire dès leur pose, pas
seulement une fois déclenchés.

IMPORTANT (quota Firestore dépassé, corrigé) : n'écrit un document QUE si
son contenu a réellement changé depuis la dernière fois — avant, chaque
position/ordre était réécrit à chaque tour (~10s) même sans le moindre
changement, ce qui a fini par épuiser le quota gratuit de Firestore
(429 Quota exceeded) à lui seul, avec 3 process qui tournent en continu.
Même principe pour le heartbeat vps_status : un vrai changement (login,
online) déclenche une écriture immédiate, sinon un simple heartbeat de
fraîcheur toutes les VPS_STATUS_HEARTBEAT_SECONDS suffit — pas besoin de
retimestamper à chaque tour de boucle.

Seule responsabilité de ce module : publier l'état tel quel. Aucune
décision, aucun calcul de risque — ça, c'est le rôle du suppléant
lui-même, sur SES propres paramètres.
"""

import time

from config import PRICE_SYMBOL, VPS_ID
from mt5_client import ensure_mt5

VPS_STATUS_HEARTBEAT_SECONDS = 60

# Dernier snapshot publié par ticket (position/ordre) — pour ne réécrire
# que ce qui a réellement changé. Dernier login/online publiés + horodatage
# du dernier heartbeat, même logique pour vps_status.
_last_published_positions = {}
_last_published_orders = {}
_last_vps_status = None
_last_vps_status_ts = 0


def _position_snapshot(pos):
    return {
        "symbol": pos.symbol,
        "type": pos.type,  # 0 = Buy, 1 = Sell (brut — le suppléant fait le mapping)
        "entry": pos.price_open,
        "sl": pos.sl,
        "tp": pos.tp,
        "volume": pos.volume,
        "comment": pos.comment,
    }


def _order_snapshot(order):
    return {
        "symbol": order.symbol,
        "order_type": order.type,  # constante MT5 brute (BUY_LIMIT, SELL_LIMIT...), transmise telle quelle
        "entry": order.price_open,
        "sl": order.sl,
        "tp": order.tp,
        "volume": order.volume_current,
        "comment": order.comment,
    }


def _publish_vps_heartbeat(db, ai):
    """Écrit vps_status/{VPS_ID} immédiatement si login/online a changé,
    sinon seulement toutes les VPS_STATUS_HEARTBEAT_SECONDS — pas à chaque
    tour de boucle (~10s), pour ne pas gaspiller le quota d'écritures sur
    une valeur qui ne change quasiment jamais."""
    global _last_vps_status, _last_vps_status_ts
    current = {"login": ai.login, "online": True}
    now = time.time()
    if current == _last_vps_status and (now - _last_vps_status_ts) < VPS_STATUS_HEARTBEAT_SECONDS:
        return
    db.collection("vps_status").document(VPS_ID).set({**current, "ts": int(now)}, merge=True)
    _last_vps_status = current
    _last_vps_status_ts = now


def publish_master_positions(db):
    m = ensure_mt5()
    if m is None:
        return

    ai = m.account_info()
    if ai is not None:
        _publish_vps_heartbeat(db, ai)

    positions = m.positions_get(symbol=PRICE_SYMBOL) or ()
    current_tickets = set()

    for pos in positions:
        ticket = pos.ticket
        current_tickets.add(ticket)
        snapshot = _position_snapshot(pos)
        if _last_published_positions.get(ticket) == snapshot:
            continue  # rien de changé depuis la dernière publication
        db.collection("mirror_positions").document(str(ticket)).set({
            "ticket": ticket,
            **snapshot,
            "updated_at": int(time.time()),
        })
        _last_published_positions[ticket] = snapshot

    closed_tickets = set(_last_published_positions) - current_tickets
    for ticket in closed_tickets:
        db.collection("mirror_positions").document(str(ticket)).delete()
        del _last_published_positions[ticket]


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
        snapshot = _order_snapshot(order)
        if _last_published_orders.get(ticket) == snapshot:
            continue  # rien de changé depuis la dernière publication
        db.collection("mirror_orders").document(str(ticket)).set({
            "ticket": ticket,
            **snapshot,
            "updated_at": int(time.time()),
        })
        _last_published_orders[ticket] = snapshot

    closed_tickets = set(_last_published_orders) - current_tickets
    for ticket in closed_tickets:
        db.collection("mirror_orders").document(str(ticket)).delete()
        del _last_published_orders[ticket]
