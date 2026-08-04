"""
on_demand.py — Répond aux demandes ponctuelles de l'app (équité, prix,
bougie, positions, synchronisation des trades).

check_all_requests fait UNE SEULE requête groupée sur commands/ (filtrée sur
status=="pending") au lieu d'une lecture fixe par type de commande à chaque
tour de boucle — ça ne coûte que le nombre de commandes réellement en
attente (0 la plupart du temps), pas 5 lectures systématiques. Chaque
document trouvé est ensuite distribué au bon handler via son id.
"""

import time
from datetime import datetime, timedelta, timezone

from google.cloud.firestore_v1.base_query import FieldFilter

from config import PRICE_SYMBOL, VPS_ID
from mt5_client import ensure_mt5
from trades import handle_trades_sync_request


def _handle_status_request(db, doc):
    """Ne publie l'équité que si l'app en a fait la demande (commands/status_request)."""
    ref = doc.reference
    m = ensure_mt5()
    if m is None:
        db.collection("vps_status").document(VPS_ID).set({"online": False, "ts": int(time.time())}, merge=True)
        ref.update({"status": "done"})
        print("[PUB] hors ligne (sur demande)")
        return

    ai = m.account_info()
    payload = {
        "online": True,
        "vps_id": VPS_ID,
        "equity": getattr(ai, "equity", None),
        "margin": getattr(ai, "margin", None),
        "free_margin": getattr(ai, "margin_free", None),
        "currency": getattr(ai, "currency", None),
        "login": getattr(ai, "login", None),
        "server": getattr(ai, "server", None),
        "ts": int(time.time()),
    }
    db.collection("vps_status").document(VPS_ID).set(payload, merge=True)
    ref.update({"status": "done"})
    print(f"[PUB] equity={payload['equity']} {payload['currency']} (sur demande)")


def _handle_price_request(db, doc):
    """Ne publie un prix que si l'app en a fait la demande (commands/price_request)."""
    ref = doc.reference
    symbol = doc.to_dict().get("symbol") or PRICE_SYMBOL
    m = ensure_mt5()
    if m is None:
        return

    m.symbol_select(symbol, True)
    tick = m.symbol_info_tick(symbol)
    if tick is None:
        return

    db.collection("prices").document(symbol).set({
        "bid": tick.bid,
        "ask": tick.ask,
        "ts": int(time.time()),
    })
    ref.update({"status": "done"})
    print(f"[PUB] {symbol} bid={tick.bid} ask={tick.ask} (sur demande)")


ORDER_TYPE_NAMES = {2: "Buy Limit", 3: "Sell Limit", 4: "Buy Stop", 5: "Sell Stop"}
POSITION_TYPE_NAMES = {0: "Buy", 1: "Sell"}


def _handle_positions_request(db, doc):
    """Ne publie les ordres différés et positions ouvertes que si l'app en a
    fait la demande (commands/positions_request) — un seul appel MT5 groupé
    pour les deux."""
    ref = doc.reference
    m = ensure_mt5()
    if m is None:
        return

    orders = m.orders_get(symbol=PRICE_SYMBOL) or ()
    positions = m.positions_get(symbol=PRICE_SYMBOL) or ()

    payload = {
        "orders": [
            {
                "ticket": o.ticket,
                "symbol": o.symbol,
                "type": ORDER_TYPE_NAMES.get(o.type, str(o.type)),
                "volume": o.volume_current,
                "price": o.price_open,
                "sl": o.sl,
                "tp": o.tp,
                "comment": o.comment,
            }
            for o in orders
        ],
        "positions": [
            {
                "ticket": p.ticket,
                "symbol": p.symbol,
                "type": POSITION_TYPE_NAMES.get(p.type, str(p.type)),
                "volume": p.volume,
                "priceOpen": p.price_open,
                "priceCurrent": p.price_current,
                "sl": p.sl,
                "tp": p.tp,
                "profit": p.profit,
                "comment": p.comment,
            }
            for p in positions
        ],
        "ts": int(time.time()),
    }

    db.collection("positions").document("main").set(payload)
    ref.update({"status": "done"})
    print(f"[PUB] {len(payload['orders'])} ordre(s) différé(s), {len(payload['positions'])} position(s) (sur demande)")


def _handle_candle_request(db, doc):
    """Ne publie le close d'une bougie que si l'app en a fait la demande (commands/candle_request)."""
    ref = doc.reference
    data = doc.to_dict()
    symbol = data.get("symbol") or PRICE_SYMBOL
    timeframe = data.get("timeframe", "H1")
    time_iso = data.get("time")
    if not time_iso:
        ref.update({"status": "done"})
        return

    m = ensure_mt5()
    if m is None:
        return

    tf_map = {"M15": m.TIMEFRAME_M15, "H1": m.TIMEFRAME_H1, "H4": m.TIMEFRAME_H4}
    tf = tf_map.get(timeframe, m.TIMEFRAME_H1)
    tf_minutes = {"M15": 15, "H1": 60, "H4": 240}.get(timeframe, 60)

    try:
        target_dt = datetime.fromisoformat(time_iso).replace(tzinfo=timezone.utc)
    except ValueError:
        ref.update({"status": "done"})
        return

    # On veut la bougie qui SE TERMINE à l'heure demandée (celle qui était en cours
    # jusque-là), jamais celle qui commence pile à cette heure-là. Plutôt que de deviner
    # un décalage fixe (7h/8h selon l'heure d'été/hiver du broker), on demande une plage
    # large se terminant juste avant target_dt et on prend la dernière bougie — ça
    # s'adapte tout seul à la grille réelle du moment.
    range_from = target_dt - timedelta(minutes=tf_minutes * 3)
    range_to = target_dt - timedelta(seconds=1)

    m.symbol_select(symbol, True)
    rates = m.copy_rates_range(symbol, tf, range_from, range_to)

    if rates is None or len(rates) == 0:
        ref.update({"status": "done"})
        return

    candle = rates[-1]
    db.collection("candles").document(symbol).set({
        "timeframe": timeframe,
        "requested_time": time_iso,
        "candle_time": int(candle["time"]),
        "open": float(candle["open"]),
        "high": float(candle["high"]),
        "low": float(candle["low"]),
        "close": float(candle["close"]),
        "volume": int(candle["tick_volume"]),
        "ts": int(time.time()),
    })
    ref.update({"status": "done"})
    print(f"[PUB] {symbol} {timeframe} O={candle['open']} H={candle['high']} L={candle['low']} C={candle['close']} (sur demande)")


HANDLERS = {
    "status_request": _handle_status_request,
    "price_request": _handle_price_request,
    "candle_request": _handle_candle_request,
    "positions_request": _handle_positions_request,
    "trades_sync_request": handle_trades_sync_request,
}


def check_all_requests(db):
    """Une seule requête groupée pour toutes les commandes "pending" de
    commands/, distribuées au bon handler selon l'id du document."""
    for doc in db.collection("commands").where(filter=FieldFilter("status", "==", "pending")).stream():
        handler = HANDLERS.get(doc.id)
        if handler:
            handler(db, doc)
