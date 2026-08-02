"""
tasks.py — Scan et exécution des tâches de trading dues (le cœur de
l'automatisation). C'est la seule partie du VPS qui agit de son propre chef,
sans qu'on le lui demande — tout le reste (on_demand.py) ne fait que répondre.
"""

import json
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from config import BACKEND_URL, CRON_SECRET, DRY_RUN, MAGIC, PRICE_SYMBOL, VPS_ID
from mt5_client import ensure_mt5
from scenarios import evaluate_task


def _account_size(db):
    """Lit le capital de référence fixe (PAS l'équité live) depuis
    vps_status/{VPS_ID}.accounts.{login}.account_size — un champ maintenu
    manuellement dans Firestore, jamais écrit par ce script."""
    doc = db.collection("vps_status").document(VPS_ID).get()
    if not doc.exists:
        return None
    data = doc.to_dict()
    login = data.get("login")
    entry = (data.get("accounts") or {}).get(str(login)) or {}
    return entry.get("account_size")


def _notify(title, body):
    """Envoie une notification push via l'API Vercel (POST /api/notify) — c'est
    la seule façon d'en envoyer, la clé VAPID privée n'existe que côté serveur.
    Ne fait rien si CRON_SECRET est absent ; n'échoue jamais bruyamment (une
    notif ratée ne doit pas empêcher la suite du traitement de la tâche)."""
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
    """Scanne les tâches Firestore encore en attente (status "pending") et
    exécute celles dont l'heure est passée. Une fois traitée (dry-run ou réel),
    _execute_task change le status ("dry_run_done"/"done") donc une tâche ne
    ressort plus de cette requête au tour suivant — pas besoin de dédoublonnage
    explicite ici.

    Note timing : `executionTime` est saisi via un sélecteur datetime-local côté
    app, donc sans fuseau horaire — cette chaîne "naïve" représente l'heure
    locale de Paris telle que vue par l'utilisateur (pas UTC). On la rend
    explicite en lui assignant Europe/Paris avant de comparer à l'heure réelle.
    """
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
    """Exécute une tâche due : récupère la bougie de référence via MT5, évalue
    le scénario, puis notifie (DRY_RUN) ou place réellement l'ordre.

    ATTENTION (limite connue, pas encore corrigée) : le statut de la tâche n'est
    marqué "done" qu'à la toute fin (ref.update en bas de fonction). Si order_send
    réussit mais qu'une erreur survient juste après (ex: coupure réseau avant
    l'écriture Firestore), le status resterait "pending" et la tâche serait
    retentée — donc potentiellement exécutée deux fois. Risque faible en
    pratique (fenêtre de quelques lignes de code) mais réel ; à corriger avant
    d'utiliser cette app avec des montants qui feraient mal en cas de doublon
    (ex: marquer "done" AVANT d'appeler order_send une fois le résultat connu,
    ou utiliser une transaction Firestore).
    """
    m = ensure_mt5()
    if m is None:
        print(f"[TASK] {task_id} : MT5 indisponible, réessai au prochain tour")
        return

    # --- 1. Récupération de la bougie de référence, même logique que
    # check_candle_request dans on_demand.py (voir son commentaire sur pourquoi
    # une plage plutôt qu'un point précis) ---
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
        # On NE marque PAS la tâche "done" ici : elle reste "pending" et sera
        # retentée au prochain tour de boucle (~10s), au cas où MT5 n'a
        # simplement pas encore la donnée.
        print(f"[TASK] {task_id} : bougie introuvable, réessai au prochain tour")
        return

    candle = {
        "open": float(rates[-1]["open"]),
        "high": float(rates[-1]["high"]),
        "low": float(rates[-1]["low"]),
        "close": float(rates[-1]["close"]),
    }

    # --- 2. Évaluation : est-ce que la condition du scénario est remplie ? ---
    account_size = _account_size(db)
    result = evaluate_task(task, candle, account_size)
    now_ms = int(time.time() * 1000)

    # --- 3a. Mode simulation (DRY_RUN, activé par défaut) : on notifie ce qui
    # AURAIT été fait, mais order_send n'est jamais appelé. ---
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

    # --- 3b. Mode réel : condition non remplie -> rien à envoyer à MT5 ---
    if not result["matched"]:
        _notify("mymt5", f"Tâche non exécutée : {result['reason']}")
        ref.update({"status": "done", "result": result, "updatedAt": now_ms})
        print(f"[TASK] {task_id} : non exécutée ({result['reason']})")
        return

    # --- 3c. Mode réel : condition remplie -> on construit et envoie l'ordre MT5 ---
    info = m.symbol_info(symbol)
    if info is None:
        result["error"] = f"Symbole inconnu : {symbol}"
        ref.update({"status": "done", "result": result, "updatedAt": now_ms})
        _notify("mymt5 — échec", result["error"])
        return

    order_type = m.ORDER_TYPE_SELL_LIMIT if result["orderType"] == "Sell Limit" else m.ORDER_TYPE_BUY_LIMIT
    request = {
        "action": m.TRADE_ACTION_PENDING,  # ordre en attente (Limit), pas un ordre au marché
        "symbol": symbol,
        "volume": float(result["lot"]),
        "type": order_type,
        "price": float(result["entry"]),
        "sl": float(result["sl"]),
        "tp": float(result["tp"]),
        "deviation": 20,
        "magic": MAGIC,  # identifiant pour repérer les ordres passés par ce script dans MT5
        "comment": f"task-{task_id}"[:28],  # commentaire MT5 limité à 28 caractères
        "type_time": m.ORDER_TIME_GTC,  # l'ordre reste actif jusqu'à annulation explicite
        "type_filling": m.ORDER_FILLING_RETURN,  # mode de remplissage requis pour un ordre en attente
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
