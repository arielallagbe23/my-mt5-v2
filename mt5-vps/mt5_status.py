"""
mt5_status.py — Publie l'équité/prix sur demande, et exécute les tâches de trading
═══════════════════════════════════════════════════════════════════════════════
Se connecte au terminal MT5 local. Toutes les POLL_INTERVAL secondes :
  - répond aux demandes ponctuelles de l'app (commands/status_request,
    price_request, candle_request, order_request) — aucune écriture en continu ;
  - scanne les tâches Firestore (collection "tasks") dont l'heure est passée,
    évalue le scénario correspondant et exécute l'ordre (ou simule en DRY_RUN).

Tout tourne côté VPS, en connexions sortantes uniquement (Firestore + appels
à l'API Vercel pour les notifications) — aucun port n'est jamais ouvert ici,
le frontend ne se connecte jamais directement au VPS.

Pré-requis (sur le VPS) :
  pip install -r requirements.txt
  service-account.json — clé Firebase Admin (même projet que l'app React)
  vps_id.txt            — optionnel, identifiant de ce VPS (défaut "main")
  cron_secret.txt        — même valeur que CRON_SECRET côté Vercel (notifications)
  dry_run.txt             — "true" (défaut) ou "false" — passer à "false" une
                            fois le comportement vérifié pour exécuter en réel
"""

import json
import os
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

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

# Déclenchement précis (±10s) du hello world de test, depuis la boucle du VPS
# plutôt que via Vercel Cron (qui peut avoir plusieurs minutes de retard).
BACKEND_URL = os.environ.get("BACKEND_URL", "https://mymt5-v2.vercel.app")
CRON_SECRET = _read("cron_secret.txt") or os.environ.get("CRON_SECRET")
HELLO_TIMES = ["11:00", "11:15", "12:00", "13:00", "14:00", "15:00"]

# Tant que dry_run.txt contient "true" (ou n'existe pas), les tâches sont évaluées
# et notifiées normalement mais AUCUN ordre réel n'est envoyé à MT5. Repasser à
# "false" dans ce fichier une fois le comportement vérifié plusieurs fois.
DRY_RUN = (_read("dry_run.txt") or os.environ.get("DRY_RUN", "true")).strip().lower() != "false"

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


CONTRACT_SIZE = 100000  # 1 lot standard = 100 000 unités de la devise de base
FEE_BUFFER = 0.05  # marge de 5% pour commissions/spread (voir mémoire risk-sizing-strategy)


def compute_lot_size(risk_amount, entry_price, sl_price, current_price):
    """Port direct de src/lib/scenarios/shared.js computeLotSize — garder synchronisé."""
    distance = abs(entry_price - sl_price)
    if not risk_amount or not distance or not current_price:
        return None

    risk_per_lot = (distance * CONTRACT_SIZE) / current_price
    if not risk_per_lot:
        return None

    lots = (risk_amount / risk_per_lot) * (1 - FEE_BUFFER)
    return max(0.01, round(lots, 2))


def fibo_price(hi, lo, level):
    return lo + (hi - lo) * level


def evaluate_sell_1(task, candle, account_size):
    """Port direct de src/lib/scenarios/sellScenario1.js evaluate — garder synchronisé.

    Condition (les deux) : close bougie <= condition de prix, ET open bougie >=
    borne haute de la golden zone (23,6% du Fibo 1 et du Fibo 2). Si rempli :
    Sell Limit, entrée = prix support, SL = Fibo1 -0,05%, TP = Fibo1 58,8%.
    """
    fibo100 = task["fibo100"]
    fibo0 = task["fibo0"]

    fibo1_236 = fibo_price(fibo100, fibo0, 0.236)
    sl = fibo_price(fibo100, fibo0, -0.05)
    tp = fibo_price(fibo100, fibo0, 0.588)

    fibo2_236 = fibo_price(fibo0, candle["low"], 0.236)
    golden_high = max(fibo1_236, fibo2_236)

    threshold = task["priceCondition"]
    entry_price = task["supportPrice"]

    close_below = candle["close"] <= threshold
    open_above = candle["open"] >= golden_high
    if not (close_below and open_above):
        return {
            "matched": False,
            "reason": f"Condition non remplie (close={candle['close']}, open={candle['open']})",
        }

    if not (sl > entry_price > tp):
        return {
            "matched": False,
            "reason": f"Ordre incohérent (SL {sl} / Entrée {entry_price} / TP {tp})",
        }

    risk_amount = (task["risk"] / 100) * account_size if account_size else None
    lot = compute_lot_size(risk_amount, entry_price, sl, candle["close"])

    return {
        "matched": True,
        "orderType": "Sell Limit",
        "entry": entry_price,
        "sl": sl,
        "tp": tp,
        "lot": lot,
    }


SCENARIO_EVALUATORS = {
    "sell-1": evaluate_sell_1,
}


def evaluate_task(task, candle, account_size):
    evaluator = SCENARIO_EVALUATORS.get(task.get("scenarioId"))
    if evaluator is None:
        return {"matched": False, "reason": f"Scénario inconnu : {task.get('scenarioId')}"}
    return evaluator(task, candle, account_size)


def _account_size(db):
    doc = db.collection("vps_status").document(VPS_ID).get()
    if not doc.exists:
        return None
    data = doc.to_dict()
    login = data.get("login")
    entry = (data.get("accounts") or {}).get(str(login)) or {}
    return entry.get("account_size")


def _notify(title, body):
    if not CRON_SECRET:
        return
    req = urllib.request.Request(
        f"{BACKEND_URL}/api/notify",
        data=json.dumps({"title": title, "body": body}).encode("utf-8"),
        headers={"Authorization": f"Bearer {CRON_SECRET}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"[NOTIFY] échec : {e}")


def check_due_tasks(db):
    """Scanne les tâches Firestore encore en attente et exécute celles dont
    l'heure est passée — évaluation, calcul de lot et (hors DRY_RUN) envoi
    de l'ordre, entièrement côté VPS."""
    now_utc = datetime.now(timezone.utc)

    for doc in db.collection("tasks").where("status", "==", "pending").stream():
        task = doc.to_dict()
        exec_raw = task.get("executionTime")
        if not exec_raw:
            continue

        try:
            exec_dt = datetime.fromisoformat(exec_raw)
        except ValueError:
            continue

        if exec_dt.tzinfo is None:
            # Saisi via le sélecteur datetime-local de l'app : heure de Paris,
            # sans indicateur de fuseau.
            exec_dt = exec_dt.replace(tzinfo=ZoneInfo("Europe/Paris"))
        target_dt = exec_dt.astimezone(timezone.utc)

        if now_utc < target_dt:
            continue  # pas encore l'heure

        _execute_task(db, doc.reference, doc.id, task, target_dt)


def _execute_task(db, ref, task_id, task, target_dt):
    m = _ensure_mt5()
    if m is None:
        print(f"[TASK] {task_id} : MT5 indisponible, réessai au prochain tour")
        return

    symbol = PRICE_SYMBOL
    timeframe = task.get("timeframe", "H1")
    tf_map = {"M15": m.TIMEFRAME_M15, "H1": m.TIMEFRAME_H1, "H4": m.TIMEFRAME_H4}
    tf = tf_map.get(timeframe, m.TIMEFRAME_H1)
    tf_minutes = {"M15": 15, "H1": 60, "H4": 240}.get(timeframe, 60)

    range_from = target_dt - timedelta(minutes=tf_minutes * 3)
    range_to = target_dt - timedelta(seconds=1)

    m.symbol_select(symbol, True)
    rates = m.copy_rates_range(symbol, tf, range_from, range_to)
    if rates is None or len(rates) == 0:
        print(f"[TASK] {task_id} : bougie introuvable, réessai au prochain tour")
        return

    candle = {
        "open": float(rates[-1]["open"]),
        "high": float(rates[-1]["high"]),
        "low": float(rates[-1]["low"]),
        "close": float(rates[-1]["close"]),
    }

    account_size = _account_size(db)
    result = evaluate_task(task, candle, account_size)
    now_ms = int(time.time() * 1000)

    if DRY_RUN:
        if result["matched"]:
            body = (
                f"[DRY-RUN] {result['orderType']} @ {result['entry']} "
                f"SL {result['sl']} TP {result['tp']} lot {result['lot']}"
            )
        else:
            body = f"[DRY-RUN] Non exécutée : {result['reason']}"
        _notify("mymt5 — tâche évaluée (dry-run)", body)
        ref.update({"status": "dry_run_done", "result": result, "updatedAt": now_ms})
        print(f"[TASK] {task_id} (dry-run) : {result}")
        return

    if not result["matched"]:
        _notify("mymt5", f"Tâche non exécutée : {result['reason']}")
        ref.update({"status": "done", "result": result, "updatedAt": now_ms})
        print(f"[TASK] {task_id} : non exécutée ({result['reason']})")
        return

    info = m.symbol_info(symbol)
    if info is None:
        result["error"] = f"Symbole inconnu : {symbol}"
        ref.update({"status": "done", "result": result, "updatedAt": now_ms})
        _notify("mymt5 — échec", result["error"])
        return

    order_type = m.ORDER_TYPE_SELL_LIMIT if result["orderType"] == "Sell Limit" else m.ORDER_TYPE_BUY_LIMIT
    request = {
        "action": m.TRADE_ACTION_PENDING,
        "symbol": symbol,
        "volume": float(result["lot"]),
        "type": order_type,
        "price": float(result["entry"]),
        "sl": float(result["sl"]),
        "tp": float(result["tp"]),
        "deviation": 20,
        "magic": MAGIC,
        "comment": f"task-{task_id}"[:28],
        "type_time": m.ORDER_TIME_GTC,
        "type_filling": m.ORDER_FILLING_RETURN,
    }

    res = m.order_send(request)
    if res is None or res.retcode != m.TRADE_RETCODE_DONE:
        error = str(m.last_error()) if res is None else res.comment
        result["error"] = error
        _notify("mymt5 — échec d'ordre", f"{result['orderType']} : {error}")
        print(f"[TASK] {task_id} : échec ordre : {error}")
    else:
        result["ticket"] = res.order
        _notify(
            "mymt5 — ordre placé",
            f"{result['orderType']} @ {result['entry']} lot {result['lot']} (ticket {res.order})",
        )
        print(f"[TASK] {task_id} : ordre placé, ticket={res.order}")

    ref.update({"status": "done", "result": result, "updatedAt": now_ms})


def check_hello_schedule(db):
    """Déclenche /api/cron/hello à l'heure de Paris pile (précision ~POLL_INTERVAL),
    au lieu de compter sur le cron Vercel qui peut retarder de plusieurs minutes."""
    if not CRON_SECRET:
        return

    now_paris = datetime.now(ZoneInfo("Europe/Paris"))
    slot = now_paris.strftime("%H:%M")
    if slot not in HELLO_TIMES:
        return

    today = now_paris.strftime("%Y-%m-%d")
    ref = db.collection("cron_runs").document("vps_hello_state")
    doc = ref.get()
    state = doc.to_dict() if doc.exists else {}
    if state.get("date") == today and state.get("slot") == slot:
        return  # déjà déclenché pour ce créneau aujourd'hui

    req = urllib.request.Request(
        f"{BACKEND_URL}/api/cron/hello",
        headers={"Authorization": f"Bearer {CRON_SECRET}"},
    )
    try:
        urllib.request.urlopen(req, timeout=10)
        print(f"[HELLO] déclenché pour {slot}")
    except Exception as e:
        print(f"[HELLO] échec pour {slot} : {e}")
        return

    ref.set({"date": today, "slot": slot})


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
            check_due_tasks(db)
            check_hello_schedule(db)
        except Exception as e:
            print(f"[LOOP] erreur : {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
