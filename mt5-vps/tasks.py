"""
tasks.py — Scan et exécution des tâches de trading dues (le cœur de
l'automatisation). C'est la seule partie du VPS qui agit de son propre chef,
sans qu'on le lui demande — tout le reste (on_demand.py) ne fait que répondre.
"""

import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from google.cloud.firestore_v1.base_query import FieldFilter

from config import DRY_RUN, MAGIC, PRICE_SYMBOL, VPS_ID
from mt5_client import ensure_mt5
from notify import notify
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


def _report_and_delete(db, ref, task_id, task, reason, now_ms):
    """Une tâche dont l'heure est passée mais dont la condition n'a pas été
    remplie n'a plus d'utilité à rester dans "tasks" — plutôt que de
    l'accumuler pour que l'utilisateur la supprime lui-même, on écrit un
    petit rapport (execution_reports) et on supprime la tâche."""
    db.collection("execution_reports").add({
        "userId": task.get("userId"),
        "taskId": task_id,
        "scenario": task.get("scenario"),
        "timeframe": task.get("timeframe"),
        "executionTime": task.get("executionTime"),
        "reason": reason,
        "archived": False,
        "createdAt": now_ms,
    })
    ref.delete()


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

    for doc in db.collection("tasks").where(filter=FieldFilter("status", "==", "pending")).stream():
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

    symbol = PRICE_SYMBOL
    timeframe = task.get("timeframe", "H1")
    tf_map = {"M15": m.TIMEFRAME_M15, "H1": m.TIMEFRAME_H1, "H4": m.TIMEFRAME_H4}
    tf = tf_map.get(timeframe, m.TIMEFRAME_H1)
    tf_minutes = {"M15": 15, "H1": 60, "H4": 240}.get(timeframe, 60)
    m.symbol_select(symbol, True)

    # --- 1a. Bougie qui SE TERMINE à l'heure fixée (ex: 23h-3h si target_dt=3h) :
    # son close (condition commune) et son low (Fibo 2 / golden zone). Même
    # logique que check_candle_request dans on_demand.py (voir son commentaire
    # sur pourquoi une plage plutôt qu'un point précis). ---
    closing_range_from = target_dt - timedelta(minutes=tf_minutes * 3)
    closing_range_to = target_dt - timedelta(seconds=1)
    closing_rates = m.copy_rates_range(symbol, tf, closing_range_from, closing_range_to)
    if closing_rates is None or len(closing_rates) == 0:
        # On NE marque PAS la tâche "done" ici : elle reste "pending" et sera
        # retentée au prochain tour de boucle (~10s), au cas où MT5 n'a
        # simplement pas encore la donnée.
        print(f"[TASK] {task_id} : bougie de clôture introuvable, réessai au prochain tour")
        return
    closing_bar = closing_rates[-1]

    # --- 1b. Bougie qui COMMENCE à l'heure fixée (celle qui vient tout juste
    # de s'ouvrir) : son open (pour savoir où se situer dans la golden zone).
    # C'est une bougie DIFFÉRENTE de la précédente — pas juste son propre champ
    # "open". On demande la plage [target_dt, maintenant] et on prend la
    # première bougie ; si le marché n'a pas encore coché depuis target_dt (on
    # peut arriver ici quelques secondes après), la liste est vide et on
    # retente au tour suivant, comme pour la bougie de clôture. ---
    opening_rates = m.copy_rates_range(symbol, tf, target_dt, datetime.now(timezone.utc))
    if opening_rates is None or len(opening_rates) == 0:
        print(f"[TASK] {task_id} : bougie d'ouverture introuvable, réessai au prochain tour")
        return
    opening_bar = opening_rates[0]

    candle = {
        "open": float(opening_bar["open"]),
        "close": float(closing_bar["close"]),
        "low": float(closing_bar["low"]),
        "high": float(closing_bar["high"]),
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
            notify("mymt5 — tâche évaluée (dry-run)", body)
            ref.update({"status": "dry_run_done", "result": result, "updatedAt": now_ms})
            print(f"[TASK] {task_id} (dry-run) : {result}")
        else:
            _report_and_delete(db, ref, task_id, task, result["reason"], now_ms)
            print(f"[TASK] {task_id} (dry-run) : non exécutée, rapport écrit ({result['reason']})")
        return

    # --- 3b. Mode réel : condition non remplie -> rien à envoyer à MT5, rapport + suppression ---
    if not result["matched"]:
        _report_and_delete(db, ref, task_id, task, result["reason"], now_ms)
        print(f"[TASK] {task_id} : non exécutée, rapport écrit ({result['reason']})")
        return

    # --- 3c. Mode réel : condition remplie -> on construit et envoie l'ordre MT5 ---
    info = m.symbol_info(symbol)
    if info is None:
        result["error"] = f"Symbole inconnu : {symbol}"
        ref.update({"status": "done", "result": result, "updatedAt": now_ms})
        notify("mymt5 — échec", result["error"])
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
        notify("mymt5 — échec d'ordre", f"{result['orderType']} : {error}")
        print(f"[TASK] {task_id} : échec ordre : {error}")
    else:
        result["ticket"] = res.order
        notify(
            "mymt5 — ordre placé",
            f"{result['orderType']} @ {result['entry']} lot {result['lot']} (ticket {res.order})",
        )
        print(f"[TASK] {task_id} : ordre placé, ticket={res.order}")

    ref.update({"status": "done", "result": result, "updatedAt": now_ms})
