"""
scheduled_orders.py — Exécute un ordre manuel (page "Ordre manuel") à une
heure fixe choisie par l'utilisateur, avec réessai automatique si ça échoue
temporairement (MT5 indisponible, spread trop large, marché fermé) — même
pattern que tasks.py (check_due_tasks/_execute_task), juste sans évaluation
de scénario : les paramètres de l'ordre (sens, type, entrée, SL, TP,
risque) sont déjà entièrement fixés à la création, il n'y a qu'à attendre
l'heure et l'envoyer.
"""

import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from google.cloud.firestore_v1.base_query import FieldFilter

from config import DRY_RUN, MAGIC, PRICE_SYMBOL
from mt5_client import ensure_mt5
from notify import notify
from scenario_shared import compute_lot_size, resolve_risk_amount
from tasks import MAX_SPREAD, SPREAD_WAIT_TIMEOUT_SECONDS, _account_size

# order_id -> horodatage UTC du premier tour où le spread était trop large —
# même mécanisme que _spread_wait_started dans tasks.py, un dict séparé
# puisque les ids ne se recoupent jamais entre les deux collections.
_spread_wait_started = {}


def _report_and_delete(db, ref, order_id, order, reason):
    """Même principe que _report_and_delete dans tasks.py : un ordre
    programmé qu'on abandonne n'a plus d'utilité à traîner — un petit
    rapport, puis suppression."""
    db.collection("execution_reports").add({
        "userId": order.get("userId"),
        "taskId": order_id,
        "scenario": order.get("side"),
        "timeframe": None,
        "executionTime": order.get("executionTime"),
        "reason": reason,
        "archived": False,
        "createdAt": int(time.time() * 1000),
    })
    notify("mymt5 — ordre programmé non exécuté", f"{order.get('side')} {order.get('orderKind')} : {reason}")
    ref.delete()


def check_due_scheduled_orders(db):
    """Même pattern que check_due_tasks (tasks.py) : scanne les ordres
    programmés en attente et exécute ceux dont l'heure est passée."""
    now_utc = datetime.now(timezone.utc)

    for doc in db.collection("scheduled_orders").where(filter=FieldFilter("status", "==", "pending")).stream():
        order = doc.to_dict()
        exec_raw = order.get("executionTime")
        if not exec_raw:
            continue

        try:
            exec_dt = datetime.fromisoformat(exec_raw)
        except ValueError:
            continue

        if exec_dt.tzinfo is None:
            # Saisi via le sélecteur datetime-local de l'app : heure de Paris,
            # sans indicateur de fuseau — même convention que tasks.py.
            exec_dt = exec_dt.replace(tzinfo=ZoneInfo("Europe/Paris"))
        target_dt = exec_dt.astimezone(timezone.utc)

        if now_utc < target_dt:
            continue  # pas encore l'heure

        _execute_scheduled_order(db, doc.reference, doc.id, order)


def _execute_scheduled_order(db, ref, order_id, order):
    m = ensure_mt5()
    if m is None:
        print(f"[SCHEDULED] {order_id} : MT5 indisponible, réessai au prochain tour")
        return

    symbol = PRICE_SYMBOL
    m.symbol_select(symbol, True)
    tick = m.symbol_info_tick(symbol)
    if tick is None:
        print(f"[SCHEDULED] {order_id} : prix indisponible, réessai au prochain tour")
        return

    side = order.get("side")
    order_kind = order.get("orderKind")
    is_buy = side == "buy"
    market_price = tick.ask if is_buy else tick.bid
    entry = market_price if order_kind == "market" else order.get("entry")
    sl = order.get("sl")
    tp = order.get("tp")

    # Même garde-fou spread que tasks.py (rollover ~23h, conditions
    # instables), avec le même abandon après SPREAD_WAIT_TIMEOUT_SECONDS.
    spread = round(tick.ask - tick.bid, 5)
    if spread > MAX_SPREAD:
        started = _spread_wait_started.setdefault(order_id, datetime.now(timezone.utc))
        waited_seconds = (datetime.now(timezone.utc) - started).total_seconds()
        if waited_seconds < SPREAD_WAIT_TIMEOUT_SECONDS:
            print(
                f"[SCHEDULED] {order_id} : spread trop large ({spread}), en attente depuis "
                f"{waited_seconds / 60:.1f} min, réessai au prochain tour"
            )
            return
        _spread_wait_started.pop(order_id, None)
        reason = f"spread resté au-dessus de {MAX_SPREAD} pendant plus de {SPREAD_WAIT_TIMEOUT_SECONDS // 60} min"
        _report_and_delete(db, ref, order_id, order, reason)
        print(f"[SCHEDULED] {order_id} : abandon, {reason}")
        return
    _spread_wait_started.pop(order_id, None)

    account_size = _account_size(db, m.account_info().login)
    risk_amount = resolve_risk_amount(order, account_size)
    lot = compute_lot_size(risk_amount, entry, sl, tick.bid)
    if lot is None:
        _report_and_delete(db, ref, order_id, order, "Lot incalculable (vérifie le risque, le compte et le SL)")
        print(f"[SCHEDULED] {order_id} : lot incalculable, abandon")
        return

    now_ms = int(time.time() * 1000)

    if order_kind == "market":
        action = m.TRADE_ACTION_DEAL
        order_type = m.ORDER_TYPE_BUY if is_buy else m.ORDER_TYPE_SELL
    else:
        action = m.TRADE_ACTION_PENDING
        order_type = m.ORDER_TYPE_BUY_LIMIT if is_buy else m.ORDER_TYPE_SELL_LIMIT

    request = {
        "action": action,
        "symbol": symbol,
        "volume": float(lot),
        "type": order_type,
        "sl": float(sl),
        "deviation": 20,
        "magic": MAGIC,
        "comment": f"scheduled-{order_id}"[:28],
        "type_time": m.ORDER_TIME_GTC,
        "type_filling": m.ORDER_FILLING_RETURN if order_kind == "pending" else m.ORDER_FILLING_IOC,
    }
    if order_kind == "pending":
        request["price"] = float(entry)
    if isinstance(tp, (int, float)):
        request["tp"] = float(tp)

    if DRY_RUN:
        notify(
            "mymt5 — [DRY-RUN] Ordre programmé",
            f"{side} {order_kind} @ {entry} SL {sl} lot {lot}",
        )
        ref.update({"status": "dry_run_done", "result": {"lot": lot, "entry": entry}, "updatedAt": now_ms})
        print(f"[SCHEDULED] {order_id} (dry-run) : {side} {order_kind} @ {entry} lot {lot}")
        return

    # Marqué "done" AVANT l'envoi réel — même principe que _execute_task
    # (tasks.py) : si le process plantait entre order_send() et cette
    # écriture, l'ordre resterait "pending" et serait repris au tour
    # suivant, donc potentiellement envoyé une deuxième fois pour de vrai.
    ref.update({"status": "done", "updatedAt": now_ms})

    res = m.order_send(request)
    if res is not None and res.retcode == m.TRADE_RETCODE_MARKET_CLOSED:
        # Marché fermé : aucun ordre n'a été placé (order_send rejeté, pas de
        # risque de doublon), donc on annule le marquage "done" et on
        # retente au tour suivant — sans limite de temps, comme tasks.py
        # (le marché rouvre toujours, pas de raison de renoncer).
        ref.update({"status": "pending", "updatedAt": int(time.time() * 1000)})
        print(f"[SCHEDULED] {order_id} : marché fermé, réessai au prochain tour")
        return

    if res is None or res.retcode != m.TRADE_RETCODE_DONE:
        error = str(m.last_error()) if res is None else res.comment
        notify("mymt5 — échec ordre programmé", f"{side} {order_kind} : {error}")
        print(f"[SCHEDULED] {order_id} : échec ordre : {error}")
        ref.update({"result": {"error": error}, "updatedAt": int(time.time() * 1000)})
    else:
        notify(
            "mymt5 — ordre programmé envoyé",
            f"{side} {order_kind} @ {entry} lot {lot} (ticket {res.order})",
        )
        print(f"[SCHEDULED] {order_id} : ordre placé, ticket={res.order}")
        ref.update({"result": {"ticket": res.order, "lot": lot}, "updatedAt": int(time.time() * 1000)})
