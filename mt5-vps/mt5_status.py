"""
mt5_status.py — Publie l'équité et le prix USDJPY dans Firestore, sur demande uniquement
═══════════════════════════════════════════════════════════════════════════════
Se connecte au terminal MT5 local. Toutes les POLL_INTERVAL secondes, vérifie si
l'app a déposé une demande (commands/status_request, commands/price_request) et
ne publie dans Firestore que si c'est le cas — aucune écriture en continu.
L'exécution d'ordres viendra dans une étape suivante.

Pré-requis (sur le VPS) :
  pip install MetaTrader5 google-cloud-firestore
  service-account.json — clé Firebase Admin (même projet que l'app React)
  vps_id.txt            — optionnel, identifiant de ce VPS (défaut "main")
"""

import os
import time
from datetime import datetime, timedelta, timezone

_DIR = os.path.dirname(os.path.abspath(__file__))


def _read(name, default=None):
    path = os.path.join(_DIR, name)
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return f.read().strip()


VPS_ID = _read("vps_id.txt") or os.environ.get("VPS_ID", "main")
SA_PATH = os.path.join(_DIR, "service-account.json")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "10"))
PRICE_SYMBOL = "USDJPY"
MAGIC = int(os.environ.get("MT5_MAGIC", "234000"))

ORDER_TYPES = {
    "BUY": "ORDER_TYPE_BUY",
    "SELL": "ORDER_TYPE_SELL",
    "BUY_LIMIT": "ORDER_TYPE_BUY_LIMIT",
    "SELL_LIMIT": "ORDER_TYPE_SELL_LIMIT",
    "BUY_STOP": "ORDER_TYPE_BUY_STOP",
    "SELL_STOP": "ORDER_TYPE_SELL_STOP",
}

mt5 = None


def _init_mt5():
    global mt5
    try:
        import MetaTrader5 as _mt5
    except ImportError:
        print("[MT5] Package absent — pip install MetaTrader5")
        return None
    if not _mt5.initialize():
        print(f"[MT5] initialize() échoué : {_mt5.last_error()}")
        return None
    ai = _mt5.account_info()
    if ai is None:
        print("[MT5] account_info() None.")
        return None
    print(f"[MT5] Connecté — login={ai.login} server={ai.server} balance={ai.balance:.2f}")
    return _mt5


def _ensure_mt5():
    global mt5
    if mt5 is not None:
        try:
            if mt5.account_info() is not None:
                return mt5
        except Exception:
            pass
    mt5 = _init_mt5()
    return mt5


def check_status_request(db):
    """Ne publie l'équité que si l'app en a fait la demande (commands/status_request)."""
    ref = db.collection("commands").document("status_request")
    doc = ref.get()
    if not doc.exists or doc.to_dict().get("status") != "pending":
        return

    m = _ensure_mt5()
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
    m = _ensure_mt5()
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

    m = _ensure_mt5()
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


def check_order_request(db):
    """Place un ordre réel sur MT5 si l'app en a fait la demande (commands/order_request)."""
    ref = db.collection("commands").document("order_request")
    doc = ref.get()
    if not doc.exists or doc.to_dict().get("status") != "pending":
        return

    data = doc.to_dict()
    request_id = data.get("request_id")
    symbol = data.get("symbol") or PRICE_SYMBOL
    action = str(data.get("action", "")).upper()
    volume = data.get("volume")
    price = data.get("price")
    sl = data.get("sl")
    tp = data.get("tp")

    def finish(result):
        if request_id:
            db.collection("orders").document(request_id).set({**result, "ts": int(time.time())})
        ref.update({"status": "done"})

    if action not in ORDER_TYPES:
        finish({"ok": False, "error": f"Action inconnue : {action}"})
        return
    if not isinstance(volume, (int, float)) or volume <= 0:
        finish({"ok": False, "error": "Volume invalide"})
        return
    if not isinstance(price, (int, float)) or price <= 0:
        finish({"ok": False, "error": "Prix invalide"})
        return

    m = _ensure_mt5()
    if m is None:
        finish({"ok": False, "error": "MT5 indisponible"})
        return

    m.symbol_select(symbol, True)
    info = m.symbol_info(symbol)
    if info is None:
        finish({"ok": False, "error": f"Symbole inconnu : {symbol}"})
        return

    is_market = action in ("BUY", "SELL")
    order_type = getattr(m, ORDER_TYPES[action])

    request = {
        "action": m.TRADE_ACTION_DEAL if is_market else m.TRADE_ACTION_PENDING,
        "symbol": symbol,
        "volume": float(volume),
        "type": order_type,
        "price": float(price),
        "deviation": 20,
        "magic": MAGIC,
        "comment": str(data.get("comment", "app"))[:28],
        "type_time": m.ORDER_TIME_GTC,
        "type_filling": m.ORDER_FILLING_IOC if is_market else m.ORDER_FILLING_RETURN,
    }
    if sl:
        request["sl"] = float(sl)
    if tp:
        request["tp"] = float(tp)

    res = m.order_send(request)
    if res is None:
        finish({"ok": False, "error": f"order_send() a retourné None : {m.last_error()}"})
        return
    if res.retcode != m.TRADE_RETCODE_DONE:
        finish({"ok": False, "error": res.comment, "retcode": res.retcode})
        print(f"[ORDER] échec {symbol} {action} : {res.comment} (retcode {res.retcode})")
        return

    finish({"ok": True, "ticket": res.order, "price": res.price, "volume": res.volume})
    print(f"[ORDER] {symbol} {action} vol={volume} @ {price} -> ticket={res.order}")


def run():
    from google.cloud import firestore

    if not os.path.exists(SA_PATH):
        raise SystemExit(f"[ERREUR] {SA_PATH} introuvable.")

    db = firestore.Client.from_service_account_json(SA_PATH)
    print(f"[BOOT] VPS_ID={VPS_ID} | poll={POLL_INTERVAL}s")

    while True:
        try:
            check_status_request(db)
            check_price_request(db)
            check_candle_request(db)
            check_order_request(db)
        except Exception as e:
            print(f"[LOOP] erreur : {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
