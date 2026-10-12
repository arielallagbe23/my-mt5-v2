"""
account_order.py — Place un ordre manuel (marché ou différé, instantané
uniquement) sur N'IMPORTE QUEL compte (principal ou suppléant), de façon
totalement indépendante : pas de mirroring, chaque compte reçoit sa propre
commande et calcule son propre lot à partir du risque demandé et de SA
propre équité — même formule que _handle_set_order_request (on_demand.py,
compte principal uniquement), ici généralisée via des paramètres explicites
(m, vps_id, account_size, magic, dry_run) plutôt que des globals liés au
compte principal, pour être appelable aussi bien depuis on_demand.py
(principal) que mirror_follower.py (chaque suppléant — ce process n'a
sinon aucune lecture de la collection commands).

Commande : commands/account_order_request_{vpsId} — un doc par compte, pour
qu'un ordre sur un compte n'interfère jamais avec un ordre en attente sur un
autre. Résultat : account_order_results/{vpsId}.

Pas de version "programmée" (heure différée) pour l'instant — seulement
l'exécution immédiate, contrairement à "Ordre manuel" (scheduled_orders.py,
compte principal uniquement).
"""

import time

from notify import notify
from scenario_shared import compute_lot_size

MAX_RISK_PERCENT = 2  # même garde-fou que partout ailleurs (config.py, tasks.py, on_demand.py)


def _publish_result(db, vps_id, result):
    db.collection("account_order_results").document(vps_id).set({**result, "ts": int(time.time())})


def command_doc_id(vps_id):
    return f"account_order_request_{vps_id}"


def handle_account_order_request(db, doc, m, vps_id, account_size, magic, dry_run, symbol):
    """m/vps_id/account_size/magic/dry_run/symbol sont fournis par
    l'appelant — cette fonction ne lit ni Firestore ni l'identité du compte
    elle-même, pour rester identique quel que soit le compte cible."""
    ref = doc.reference
    data = doc.to_dict()

    m.symbol_select(symbol, True)
    tick = m.symbol_info_tick(symbol)
    if tick is None:
        ref.update({"status": "done"})
        _publish_result(db, vps_id, {"success": False, "error": "Prix indisponible"})
        return

    side = data.get("side")  # "buy" | "sell"
    order_kind = data.get("orderKind")  # "market" | "pending"
    sl = data.get("sl")
    tp = data.get("tp")
    risk_percent = data.get("risk")
    is_buy = side == "buy"
    market_price = tick.ask if is_buy else tick.bid
    entry = market_price if order_kind == "market" else data.get("entry")

    result = {"vpsId": vps_id, "side": side, "orderKind": order_kind, "entry": entry, "sl": sl, "tp": tp, "success": False}

    # Garde-fou : jamais plus de MAX_RISK_PERCENT, même si la validation côté
    # API a été contournée (même principe que set_order_request).
    if not isinstance(risk_percent, (int, float)) or risk_percent <= 0 or risk_percent > MAX_RISK_PERCENT:
        result["error"] = f"Risque invalide (doit être entre 0 et {MAX_RISK_PERCENT}%)"
        ref.update({"status": "done"})
        _publish_result(db, vps_id, result)
        return

    risk_amount = (risk_percent / 100) * account_size if account_size else None
    lot = compute_lot_size(risk_amount, entry, sl, tick.bid)
    if lot is None:
        result["error"] = "Lot incalculable (vérifie le risque, le compte et le SL)"
        ref.update({"status": "done"})
        _publish_result(db, vps_id, result)
        return
    result["lot"] = lot

    if order_kind == "market":
        action = m.TRADE_ACTION_DEAL
        order_type = m.ORDER_TYPE_BUY if is_buy else m.ORDER_TYPE_SELL
    else:
        # Toujours Limit, jamais Stop — même convention que partout ailleurs
        # dans ce projet.
        action = m.TRADE_ACTION_PENDING
        order_type = m.ORDER_TYPE_BUY_LIMIT if is_buy else m.ORDER_TYPE_SELL_LIMIT

    request = {
        "action": action,
        "symbol": symbol,
        "volume": float(lot),
        "type": order_type,
        "sl": float(sl),
        "deviation": 20,
        "magic": magic,
        "comment": "account-order",
        "type_time": m.ORDER_TIME_GTC,
        "type_filling": m.ORDER_FILLING_RETURN if order_kind == "pending" else m.ORDER_FILLING_IOC,
    }
    if order_kind == "pending":
        request["price"] = float(entry)
    if isinstance(tp, (int, float)):
        request["tp"] = float(tp)

    if dry_run:
        result["success"] = True
        result["dryRun"] = True
        notify(
            f"mymt5 — [DRY-RUN] Ordre ({vps_id})",
            f"{side} {order_kind} @ {entry} SL {sl} lot {lot}",
        )
        ref.update({"status": "done"})
        _publish_result(db, vps_id, result)
        print(f"[ACCOUNT_ORDER] ({vps_id}, dry-run) {side} {order_kind} @ {entry} SL {sl} lot {lot}")
        return

    # Marqué "done" AVANT l'envoi réel — même principe que set_order_request :
    # si le process plantait entre order_send() et cette écriture, la
    # commande resterait "pending" et serait reprise au tour suivant,
    # envoyant le même ordre en double.
    ref.update({"status": "done"})

    res = m.order_send(request)
    if res is None or res.retcode != m.TRADE_RETCODE_DONE:
        error = str(m.last_error()) if res is None else res.comment
        result["error"] = error
        notify(f"mymt5 — échec ordre ({vps_id})", error)
        print(f"[ACCOUNT_ORDER] ({vps_id}) échec : {error}")
    else:
        result["success"] = True
        result["ticket"] = res.order
        notify(
            f"mymt5 — ordre envoyé ({vps_id})",
            f"{side} {order_kind} @ {entry} lot {lot} (ticket {res.order})",
        )
        print(f"[ACCOUNT_ORDER] ({vps_id}) ordre placé, ticket={res.order}")

    _publish_result(db, vps_id, result)
