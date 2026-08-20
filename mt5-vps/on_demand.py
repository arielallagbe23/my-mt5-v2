"""
on_demand.py — Répond aux demandes ponctuelles de l'app (équité, prix,
bougie, positions, synchronisation des trades).

check_all_requests fait UNE SEULE requête groupée sur commands/ (filtrée sur
status=="pending") au lieu d'une lecture fixe par type de commande à chaque
tour de boucle — ça ne coûte que le nombre de commandes réellement en
attente (0 la plupart du temps), pas 5 lectures systématiques. Chaque
document trouvé est ensuite distribué au bon handler via son id.
"""

import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

from google.cloud.firestore_v1.base_query import FieldFilter

from config import DRY_RUN, MAGIC, MAX_RISK_PERCENT, PRICE_SYMBOL, VPS_ID
from mt5_client import ensure_mt5
from notify import notify
from scenario_shared import compute_lot_size
from tasks import _account_size
from trades import handle_trades_sync_request

MARKET_RECAP_SCRIPTS = [
    "01_taux_fed_boj.py",
    "02_calendrier_eco.py",
    "03_risque_intervention.py",
    "04_sentiment_risk_on_off.py",
    "05_structure_d1.py",
    "06_confirmation_h4.py",
    "07_setup_h1.py",
    "08_correlation_10y.py",
    "09_bilan_quotidien.py",
]


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


def _publish_order_result(db, result):
    db.collection("order_results").document("main").set({**result, "ts": int(time.time())})


def _handle_set_order_request(db, doc):
    """Place un ordre manuel (marché ou différé) depuis l'app — commands/set_order_request.
    Le lot n'est jamais saisi à la main : calculé automatiquement à partir du
    risque, de l'entrée et du SL, avec compute_lot_size — la même formule
    (et le même plancher 0,01 lot) que les tâches automatiques, pour ne
    jamais avoir deux façons différentes de calculer un lot dans ce projet.

    Respecte DRY_RUN comme tout le reste : en simulation, on notifie ce qui
    aurait été envoyé sans jamais appeler order_send()."""
    ref = doc.reference
    data = doc.to_dict()

    m = ensure_mt5()
    if m is None:
        ref.update({"status": "done"})
        _publish_order_result(db, {"success": False, "error": "MT5 indisponible"})
        return

    symbol = PRICE_SYMBOL
    m.symbol_select(symbol, True)
    tick = m.symbol_info_tick(symbol)
    if tick is None:
        ref.update({"status": "done"})
        _publish_order_result(db, {"success": False, "error": "Prix indisponible"})
        return

    side = data.get("side")  # "buy" | "sell"
    order_kind = data.get("orderKind")  # "market" | "pending"
    sl = data.get("sl")
    tp = data.get("tp")
    risk_percent = data.get("risk")
    is_buy = side == "buy"
    market_price = tick.ask if is_buy else tick.bid
    entry = market_price if order_kind == "market" else data.get("entry")

    result = {"side": side, "orderKind": order_kind, "entry": entry, "sl": sl, "tp": tp, "success": False}

    # Garde-fou : jamais plus de MAX_RISK_PERCENT, même si la validation côté
    # API a été contournée (même principe que tasks.py/scenarios.py).
    if not isinstance(risk_percent, (int, float)) or risk_percent <= 0 or risk_percent > MAX_RISK_PERCENT:
        result["error"] = f"Risque invalide (doit être entre 0 et {MAX_RISK_PERCENT}%)"
        ref.update({"status": "done"})
        _publish_order_result(db, result)
        return

    account_size = _account_size(db, m.account_info().login)
    risk_amount = (risk_percent / 100) * account_size if account_size else None
    lot = compute_lot_size(risk_amount, entry, sl, tick.bid)
    if lot is None:
        result["error"] = "Lot incalculable (vérifie le risque, le compte et le SL)"
        ref.update({"status": "done"})
        _publish_order_result(db, result)
        return
    result["lot"] = lot

    if order_kind == "market":
        action = m.TRADE_ACTION_DEAL
        order_type = m.ORDER_TYPE_BUY if is_buy else m.ORDER_TYPE_SELL
    else:
        # Toujours Limit, jamais Stop — même convention que tasks.py pour les
        # tâches automatiques. Si l'entrée est du mauvais côté du prix actuel,
        # order_send() le refusera avec une erreur explicite plutôt que de
        # placer silencieusement un ordre Stop non demandé.
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
        "comment": "set-order",
        "type_time": m.ORDER_TIME_GTC,
        "type_filling": m.ORDER_FILLING_RETURN if order_kind == "pending" else m.ORDER_FILLING_IOC,
    }
    if order_kind == "pending":
        request["price"] = float(entry)
    if isinstance(tp, (int, float)):
        request["tp"] = float(tp)

    if DRY_RUN:
        result["success"] = True
        result["dryRun"] = True
        notify(
            "mymt5 — [DRY-RUN] Ordre manuel",
            f"{side} {order_kind} @ {entry} SL {sl} lot {lot}",
        )
        ref.update({"status": "done"})
        _publish_order_result(db, result)
        print(f"[SET_ORDER] (dry-run) {side} {order_kind} @ {entry} SL {sl} lot {lot}")
        return

    # Marqué "done" AVANT l'envoi réel : si le process plantait entre
    # order_send() et cette écriture, la commande resterait "pending" et
    # serait reprise par check_all_requests au tour suivant (~10s) — donc un
    # deuxième ordre réel enverrait le même ordre en double. Même principe
    # que pour _execute_task dans tasks.py.
    ref.update({"status": "done"})

    res = m.order_send(request)
    if res is None or res.retcode != m.TRADE_RETCODE_DONE:
        error = str(m.last_error()) if res is None else res.comment
        result["error"] = error
        notify("mymt5 — échec ordre manuel", error)
        print(f"[SET_ORDER] échec : {error}")
    else:
        result["success"] = True
        result["ticket"] = res.order
        notify(
            "mymt5 — ordre manuel envoyé",
            f"{side} {order_kind} @ {entry} lot {lot} (ticket {res.order})",
        )
        print(f"[SET_ORDER] ordre placé, ticket={res.order}")

    _publish_order_result(db, result)


def _publish_close_position_result(db, result):
    db.collection("close_position_results").document("main").set({**result, "ts": int(time.time())})


def _handle_close_position_request(db, doc):
    """Ferme une position au marché depuis l'app (bouton "urgence" sur la
    carte de position) — commands/close_position_request. Respecte DRY_RUN
    comme tout le reste : en simulation, on notifie ce qui aurait été
    envoyé sans jamais appeler order_send(). La notif "position fermée"
    (net en $) part séparément, au prochain tour, via check_position_level
    (comme pour un SL/TP touché) — pas la peine de la dupliquer ici."""
    ref = doc.reference
    ticket = doc.to_dict().get("ticket")
    result = {"ticket": ticket, "success": False}

    m = ensure_mt5()
    if m is None:
        result["error"] = "MT5 indisponible"
        ref.update({"status": "done"})
        _publish_close_position_result(db, result)
        return

    positions = m.positions_get(ticket=ticket) or ()
    if not positions:
        result["error"] = "Position introuvable (déjà fermée ?)"
        ref.update({"status": "done"})
        _publish_close_position_result(db, result)
        return
    pos = positions[0]

    tick = m.symbol_info_tick(pos.symbol)
    if tick is None:
        result["error"] = "Prix indisponible"
        ref.update({"status": "done"})
        _publish_close_position_result(db, result)
        return

    is_buy = pos.type == 0  # POSITION_TYPE_BUY
    side = "Buy" if is_buy else "Sell"

    if DRY_RUN:
        result["success"] = True
        result["dryRun"] = True
        notify("mymt5 — [DRY-RUN] Fermeture manuelle", f"{pos.symbol} {side} (ticket {ticket}) fermerait ici")
        ref.update({"status": "done"})
        _publish_close_position_result(db, result)
        print(f"[CLOSE] (dry-run) ticket {ticket} fermerait ici")
        return

    # Marqué "done" AVANT l'envoi réel — même principe que _execute_task
    # (tasks.py) et _handle_set_order_request ci-dessus : si le process
    # plantait entre order_send() et cette écriture, la commande resterait
    # "pending" et serait reprise au tour suivant, envoyant potentiellement
    # un deuxième ordre de clôture.
    ref.update({"status": "done"})

    res = m.order_send({
        "action": m.TRADE_ACTION_DEAL,
        "position": ticket,
        "symbol": pos.symbol,
        "volume": pos.volume,
        "type": m.ORDER_TYPE_SELL if is_buy else m.ORDER_TYPE_BUY,
        "price": tick.bid if is_buy else tick.ask,
        "deviation": 20,
        "magic": MAGIC,
        "comment": "manual-close",
        "type_time": m.ORDER_TIME_GTC,
        "type_filling": m.ORDER_FILLING_IOC,
    })

    if res is None or res.retcode != m.TRADE_RETCODE_DONE:
        error = str(m.last_error()) if res is None else res.comment
        result["error"] = error
        notify("mymt5 — échec fermeture manuelle", f"{pos.symbol} {side} (ticket {ticket}) : {error}")
        print(f"[CLOSE] échec ticket {ticket} : {error}")
    else:
        result["success"] = True
        notify("mymt5 — position fermée manuellement", f"{pos.symbol} {side} (ticket {ticket})")
        print(f"[CLOSE] ticket {ticket} fermé manuellement")

    _publish_close_position_result(db, result)


def _handle_market_recap_request(db, doc):
    """Relance à la main les 9 scripts qui alimentent le Market Recap
    (commands/market_recap_request) — pour le cas où la tâche planifiée du
    matin a échoué. Chaque script tourne en process séparé (comme depuis le
    Planificateur de tâches), donc un script qui plante n'empêche pas les
    autres de s'exécuter. Bloque la boucle principale le temps du
    rafraîchissement (généralement moins d'une minute) : acceptable pour une
    action manuelle ponctuelle, contrairement aux vérifications automatiques
    qui tournent toutes les 10s."""
    ref = doc.reference
    failed = []
    for script in MARKET_RECAP_SCRIPTS:
        result = subprocess.run(
            [sys.executable, script], capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            failed.append(script)
            print(f"[MARKET_RECAP] {script} a échoué : {result.stderr[-500:]}")
        else:
            print(f"[MARKET_RECAP] {script} OK")

    ref.update({"status": "done", "failed": failed, "completed_at": int(time.time())})
    if failed:
        notify("mymt5 — rafraîchissement partiel", f"{len(failed)}/9 scripts ont échoué : {', '.join(failed)}")
    print(f"[MARKET_RECAP] terminé, {len(failed)} échec(s) sur {len(MARKET_RECAP_SCRIPTS)}")


HANDLERS = {
    "status_request": _handle_status_request,
    "price_request": _handle_price_request,
    "candle_request": _handle_candle_request,
    "positions_request": _handle_positions_request,
    "trades_sync_request": handle_trades_sync_request,
    "set_order_request": _handle_set_order_request,
    "close_position_request": _handle_close_position_request,
    "market_recap_request": _handle_market_recap_request,
}


def check_all_requests(db):
    """Une seule requête groupée pour toutes les commandes "pending" de
    commands/, distribuées au bon handler selon l'id du document."""
    for doc in db.collection("commands").where(filter=FieldFilter("status", "==", "pending")).stream():
        handler = HANDLERS.get(doc.id)
        if handler:
            handler(db, doc)
