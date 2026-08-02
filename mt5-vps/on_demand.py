"""
on_demand.py — Répond aux demandes ponctuelles de l'app (équité, prix, bougie).

Chaque fonction suit le même motif : elle ne fait RIEN tant que l'app n'a pas
déposé une demande (commands/{type}_request avec status="pending") — aucune
écriture en continu dans Firestore.
"""

import time
from datetime import datetime, timedelta, timezone

from config import PRICE_SYMBOL, VPS_ID
from mt5_client import ensure_mt5


def check_status_request(db):
    """Ne publie l'équité que si l'app en a fait la demande (commands/status_request)."""
    ref = db.collection("commands").document("status_request")
    doc = ref.get()
    if not doc.exists or doc.to_dict().get("status") != "pending":
        return

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


def check_price_request(db):
    """Ne publie un prix que si l'app en a fait la demande (commands/price_request)."""
    ref = db.collection("commands").document("price_request")
    doc = ref.get()
    if not doc.exists or doc.to_dict().get("status") != "pending":
        return

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


def check_positions_request(db):
    """Ne publie les ordres différés et positions ouvertes que si l'app en a
    fait la demande (commands/positions_request) — un seul appel MT5 groupé
    pour les deux, pas de polling continu."""
    ref = db.collection("commands").document("positions_request")
    doc = ref.get()
    if not doc.exists or doc.to_dict().get("status") != "pending":
        return

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


def check_candle_request(db):
    """Ne publie le close d'une bougie que si l'app en a fait la demande (commands/candle_request)."""
    ref = db.collection("commands").document("candle_request")
    doc = ref.get()
    if not doc.exists or doc.to_dict().get("status") != "pending":
        return

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
