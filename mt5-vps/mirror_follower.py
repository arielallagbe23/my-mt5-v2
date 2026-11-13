#!/usr/bin/env python3
"""
mirror_follower.py — Process SÉPARÉ pour un compte suppléant : reproduit en
quasi temps réel les positions ET les ordres différés USDJPY publiés par
mirror_publish.py (compte principal), avec un lot recalculé selon LA PROPRE
Stratégie de risque de ce suppléant (account_settings/{FOLLOWER_ID}.riskStrategy
+ sa propre équité live — voir compute_follower_lot_by_strategy) : le lot/risque
réellement utilisé côté principal n'entre pas en compte, chaque suppléant
applique son propre risque % à la distance entrée/SL de la position mirrorée.
Si le suppléant est en mode "manuel" (pas de stratégie choisie), on retombe
sur un simple prorata de l'account_size par rapport au principal (voir
compute_follower_lot) — account_size et riskStrategy sont mis en cache 60s
(ACCOUNT_SIZE_CACHE_SECONDS) pour s'adapter automatiquement si un palier
change (challenge validé, scaling plan, stratégie changée...) sans relire
Firestore à chaque tour de boucle pour retomber sur la même valeur.

IMPORTANT (quota Firestore dépassé, corrigé) : les écritures (statut,
état des miroirs) ne partent plus que si le contenu a réellement changé, ou
au pire toutes les 60s en heartbeat — avant, tout était réécrit à chaque
tour (~10s) même sans le moindre changement, ce qui a fini par épuiser le
quota gratuit Firestore (429 Quota exceeded) avec 3 process en continu.
Même logique côté lecture : mirror_positions/mirror_orders (l'état du
compte principal) ne sont plus interrogés à chaque tour (.stream()) mais
poussés par deux écouteurs temps réel (on_snapshot) — Firestore prévient
uniquement quand quelque chose change vraiment, pas de lecture entre deux
changements réels.

Un ordre différé est répliqué dès sa pose (pas seulement une fois
déclenché) : en mode Hedging, l'ordre garde le même ticket en devenant une
position, donc le même suivi (_mirrored_tickets) gère les deux étapes sans
distinction ni double mirroring.

Aucune décision de trading ici pour le miroir USDJPY : ce compte ne fait
qu'imiter le compte principal (ouverture, ajustement SL/TP, clôture),
jamais évaluer de scénario lui-même — le compte principal reste le seul
"cerveau" pour cette paire-là.

Multi-actifs (task_signals, voir tasks.py et _execute_task_signal) : pour
un symbole que MASTER lui-même ne trade jamais, il n'y a tout simplement
aucune position MASTER à imiter — ce process exécute alors DIRECTEMENT le
signal de la tâche, mais SEULEMENT si CE compte a explicitement activé ce
symbole (account_settings/{FOLLOWER_ID}.symbols, voir Mes comptes). Le
"cerveau" (évaluation de la condition) reste côté MASTER (tasks.py) ; ce
qui change ici, c'est seulement QUI exécute l'ordre une fois la condition
remplie.

À lancer comme un process à part entière (`python mirror_follower.py`),
connecté à un DEUXIÈME terminal MT5 (jamais le même que le compte
principal — un terminal ne peut être connecté qu'à un compte à la fois).

Config dédiée (fichiers locaux dans ce même dossier, jamais commités — même
régime que cron_secret.txt) :
  follower_id.txt             — identifiant Firestore de CE compte (ex: "account2")
  follower_terminal_path.txt  — chemin complet vers le terminal64.exe de CE compte (obligatoire)
  follower_dry_run.txt        — "true" (défaut) ou "false" — indépendant du DRY_RUN du compte principal
  master_vps_id.txt           — optionnel, VPS_ID du compte principal (défaut "main")

Pré-requis Firestore (comme pour le compte principal) :
  vps_status/{follower_id}.accounts.{login}.account_size — maintenu à la
  main dans Firestore, jamais écrit par ce script.
"""

import os
import sys
import threading
import time
import traceback

from google.api_core.exceptions import ResourceExhausted

from account_order import command_doc_id, handle_account_order_request
from mt5_client import ensure_mt5
from scenario_shared import RISK_STRATEGY_PRESETS, compute_auto_risk, compute_growth_percent, compute_lot_size

# Durée d'attente après un throttle Firestore (429 ResourceExhausted) avant de
# retenter — voir la même constante et la même logique dans mt5_status.py.
QUOTA_COOLDOWN_SECONDS = 60

# Windows ouvre souvent la console avec l'ancien codepage (cp1252), qui ne
# sait pas encoder certains caractères utilisés dans nos messages (ex: "→")
# — sans ça, un simple print() plante le process entier. Voir la même note
# dans mt5_status.py pour le détail.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

_DIR = os.path.dirname(os.path.abspath(__file__))


def _read(name, default=None):
    path = os.path.join(_DIR, name)
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return f.read().strip()


# Variable d'env prioritaire sur le fichier local : les fichiers follower_*.txt
# sont partagés par TOUS les process mirror_follower.py lancés depuis ce même
# dossier (_DIR est toujours mt5-vps/, quel que soit le process qui lit) — un
# deuxième suppléant lancé en parallèle lirait sinon la même identité que le
# premier. run_all.py distingue chaque instance en lui passant des variables
# d'env dédiées ; en lancement manuel (python mirror_follower.py, pas d'env),
# le fichier local reste le comportement par défaut, inchangé.
FOLLOWER_ID = os.environ.get("FOLLOWER_ID") or _read("follower_id.txt") or "account2"
TERMINAL_PATH = os.environ.get("FOLLOWER_TERMINAL_PATH") or _read("follower_terminal_path.txt")
DRY_RUN = (os.environ.get("FOLLOWER_DRY_RUN") or _read("follower_dry_run.txt") or "true").strip().lower() != "false"
MASTER_VPS_ID = os.environ.get("MASTER_VPS_ID") or _read("master_vps_id.txt") or "main"
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "10"))
SA_PATH = os.path.join(_DIR, "service-account.json")

PRICE_SYMBOL = "USDJPY"
MAGIC = int(os.environ.get("FOLLOWER_MAGIC", "234100"))  # différent du MAGIC du compte principal (234000)

# ticket compte principal (str) -> ticket compte suppléant (int, ou -1 en
# DRY_RUN — pas de vrai ticket). Persisté dans Firestore (mirror_state) pour
# survivre à un redémarrage de ce process.
_mirrored_tickets = {}

# Un ticket (position/ordre) déjà ouvert côté principal AVANT le démarrage
# de CE process suppléant n'est jamais mirroité rétroactivement. Décidé au
# cas par cas via son updated_at (mirror_publish.py) comparé à l'instant de
# démarrage (_follower_boot_time) — PAS via "était-il déjà présent dans le
# tout premier instantané Firestore reçu" (ancien comportement). Cette
# première approche était sujette à une course observée en prod : une tâche
# exécutée côté principal dans les toutes premières secondes du démarrage
# du suppléant pouvait atterrir dans ce tout premier instantané et être
# prise à tort pour "déjà là avant nous", donc jamais mirroitée.
# PRE_EXISTING_GRACE_SECONDS absorbe l'imprécision d'horodatage (secondes
# entières) entre les deux process — mieux vaut mirroiter un cas limite que
# le rater.
_follower_boot_time = None
_ignored_pre_existing_tickets = set()
PRE_EXISTING_GRACE_SECONDS = 5

# account_size change rarement (palier de challenge, scaling plan...) — pas
# besoin de le relire à chaque tour (~10s) juste pour retomber sur la même
# valeur. Cache court (60s) par vps_id : {vps_id: (valeur, lu_à)}.
ACCOUNT_SIZE_CACHE_SECONDS = 60
_account_size_cache = {}

# État du compte principal (positions ouvertes + ordres différés), poussé
# par deux écouteurs temps réel (on_snapshot) sur mirror_positions et
# mirror_orders — jamais interrogé nous-mêmes en boucle : Firestore nous
# prévient automatiquement dès qu'un document change, pas de lecture entre
# deux changements réels (contrairement à un .stream() à chaque tour).
#
# task_signals (3e écouteur) : PAS l'état d'une position MASTER — ce sont
# les signaux de tâches multi-actifs (voir tasks.py, _publish_task_signal),
# qui existent même quand MASTER ne trade jamais lui-même le symbole. Même
# mécanisme d'écoute temps réel que les deux autres, pour la même raison
# (pas de lecture répétée d'une collection qui ne change presque jamais).
#
# _positions_ready / _orders_ready / _signals_ready : au tout premier
# démarrage, un écouteur met un court instant à livrer son premier résultat
# — tant que ce n'est pas fait, le cache est vide alors que le compte
# principal a peut-être déjà des positions ouvertes. Sans ce garde-fou,
# sync_mirror agirait sur une image incomplète et pourrait croire (à tort)
# que tout a fermé côté principal, et fermer des miroirs par erreur.
_master_state_lock = threading.Lock()
_master_positions_cache = {}
_master_orders_cache = {}
_task_signals_cache = {}
_positions_ready = False
_orders_ready = False
_signals_ready = False
_master_state_listeners_started = False
_listeners_started_at = None

# Filet de sécurité : un écouteur qui reste bloqué "pas prêt" (permission
# Firestore, coupure réseau au tout démarrage...) fait attendre sync_mirror
# indéfiniment SANS AUCUNE erreur — contrairement à l'ancien .stream() à
# chaque tour, qui aurait fait planter bruyamment. Passé ce délai, on log un
# avertissement explicite à chaque tour tant que ça n'est pas résolu, pour
# qu'une panne ne reste jamais silencieuse.
LISTENER_STARTUP_WARNING_SECONDS = 60


def _on_positions_snapshot(query_snapshot, changes, read_time):
    global _positions_ready
    with _master_state_lock:
        _master_positions_cache.clear()
        for doc in query_snapshot:
            data = doc.to_dict()
            _master_positions_cache[str(data["ticket"])] = data
        _positions_ready = True


def _on_orders_snapshot(query_snapshot, changes, read_time):
    global _orders_ready
    with _master_state_lock:
        _master_orders_cache.clear()
        for doc in query_snapshot:
            data = doc.to_dict()
            _master_orders_cache[str(data["ticket"])] = data
        _orders_ready = True


def _on_task_signals_snapshot(query_snapshot, changes, read_time):
    global _signals_ready
    with _master_state_lock:
        _task_signals_cache.clear()
        for doc in query_snapshot:
            _task_signals_cache[doc.id] = doc.to_dict()
        _signals_ready = True


def _start_master_state_listeners(db):
    """Démarre les trois écouteurs une seule fois (threads gérés par le SDK
    Firestore) — idempotent, sans effet si déjà démarrés."""
    global _master_state_listeners_started, _listeners_started_at
    if _master_state_listeners_started:
        return
    db.collection("mirror_positions").on_snapshot(_on_positions_snapshot)
    db.collection("mirror_orders").on_snapshot(_on_orders_snapshot)
    db.collection("task_signals").on_snapshot(_on_task_signals_snapshot)
    _master_state_listeners_started = True
    _listeners_started_at = time.time()


def _account_size(db, vps_id):
    """Même logique que _account_size dans tasks.py, mais paramétrée par
    vps_id — le compte principal et le suppléant ont chacun le leur."""
    cached = _account_size_cache.get(vps_id)
    if cached is not None and (time.time() - cached[1]) < ACCOUNT_SIZE_CACHE_SECONDS:
        return cached[0]

    doc = db.collection("vps_status").document(vps_id).get()
    value = None
    if doc.exists:
        data = doc.to_dict()
        login = data.get("login")
        entry = (data.get("accounts") or {}).get(str(login)) or {}
        value = entry.get("account_size")

    _account_size_cache[vps_id] = (value, time.time())
    return value


# account_settings change rarement (changé à la main sur Mes comptes) — même
# cache 60s que _account_size, pour ne pas relire Firestore à chaque tour.
# Clé = vps_id SEUL (PAS (vps_id, symbol) — bug corrigé : ça relisait le MÊME
# document une fois par symbole interrogé, donc jusqu'à 3x plus de lectures
# que nécessaire à chaque expiration de cache. Un seul doc contient déjà tous
# les symboles, donc une seule lecture suffit pour les résoudre tous).
_account_settings_cache = {}


def _account_settings(db, vps_id):
    cached = _account_settings_cache.get(vps_id)
    if cached is not None and (time.time() - cached[1]) < ACCOUNT_SIZE_CACHE_SECONDS:
        return cached[0]

    doc = db.collection("account_settings").document(vps_id).get()
    data = doc.to_dict() if doc.exists else {}
    _account_settings_cache[vps_id] = (data, time.time())
    return data


def _resolve_symbol_settings(db, vps_id, symbol):
    """Équivalent Python de resolveSymbolSettings (server/src/routes/account.js,
    dupliqué ici comme _account_size plus haut : processus séparé, pas de
    module Firestore partagé entre le serveur Node et le VPS). USDJPY reste
    toujours activé, piloté par le champ historique `riskStrategy` (legacy,
    pas de case à cocher) ; les autres symboles sont dans
    account_settings/{vps_id}.symbols.{symbol}, désactivés par défaut
    (opt-in explicite, voir Mes comptes)."""
    data = _account_settings(db, vps_id)
    if symbol == PRICE_SYMBOL:
        value = {"enabled": True, "riskStrategy": data.get("riskStrategy") or "manual"}
    else:
        entry = (data.get("symbols") or {}).get(symbol) or {}
        value = {"enabled": bool(entry.get("enabled", False)), "riskStrategy": entry.get("riskStrategy") or "manual"}

    return value


def compute_follower_lot(master_volume, master_account_size, follower_account_size):
    """Prorata simple sur l'account_size — le lot suit le même ratio que
    les tailles de compte (compte suppléant deux fois plus gros -> lot
    doublé), pas un recalcul indépendant du risque à partir de l'entrée/SL.
    Filet de secours UNIQUEMENT : utilisé quand le suppléant est en mode
    "manuel" (pas de Stratégie de risque choisie) — voir
    compute_follower_lot_by_strategy, qui a priorité dès qu'une stratégie
    est configurée."""
    if not master_account_size or not follower_account_size or not master_volume:
        return None
    ratio = follower_account_size / master_account_size
    return max(0.01, round(master_volume * ratio, 2))


def compute_follower_lot_by_strategy(db, m, follower_account_size, entry, sl, symbol=PRICE_SYMBOL):
    """Lot calculé à partir du risque PROPRE à ce suppléant (sa Stratégie de
    risque choisie sur Mes comptes POUR CE SYMBOLE + SA propre équité live),
    à la distance entrée/SL de la position/ordre mirroré ou du signal de
    tâche — complètement indépendant du lot ou du risque réellement utilisé
    côté compte principal. Retourne None si le suppléant est en mode
    "manuel" (pas de stratégie à appliquer, voir compute_follower_lot) ou si
    une donnée nécessaire manque.

    `symbol` : PRICE_SYMBOL (USDJPY) par défaut pour les deux appels miroir
    existants (compat), mais passé explicitement pour un signal de tâche
    multi-actifs (voir _execute_task_signal) — NOTE : compute_lot_size
    suppose une paire cotée en JPY pour la conversion JPY->devise du compte
    (voir sa docstring) ; pas encore correct pour XAUUSD, formule séparée à
    faire (todo multi-actifs, étape 3)."""
    settings = _resolve_symbol_settings(db, FOLLOWER_ID, symbol)
    preset = RISK_STRATEGY_PRESETS.get(settings["riskStrategy"])
    if preset is None:
        return None

    ai = m.account_info()
    if ai is None or not follower_account_size:
        return None

    growth = compute_growth_percent(ai.equity, follower_account_size)
    risk_percent = compute_auto_risk(growth, preset["tiers"], preset["cap_risk"])
    if risk_percent is None:
        return None
    risk_amount = (risk_percent / 100) * follower_account_size

    tick = m.symbol_info_tick(symbol)
    if tick is None:
        return None

    return compute_lot_size(risk_amount, entry, sl, tick.bid)


STATUS_HEARTBEAT_SECONDS = 60

_last_published_status = None
_last_published_status_ts = 0


def _publish_own_status(db, m):
    """Publie équité/login du suppléant — même forme de doc que le compte
    principal (vps_status/{VPS_ID}), juste sous FOLLOWER_ID. _account_size
    lit le champ `login` de ce doc pour retrouver le bon account_size.

    N'écrit que si login/online a changé, ou au moins toutes les
    STATUS_HEARTBEAT_SECONDS pour garder l'équité affichée à peu près
    fraîche — pas à chaque tour de boucle (~10s), qui a fini par épuiser
    le quota gratuit Firestore avec 3 process tournant en continu."""
    global _last_published_status, _last_published_status_ts
    ai = m.account_info()
    if ai is None:
        return

    current = {"login": ai.login, "online": True}
    now = time.time()
    if current == _last_published_status and (now - _last_published_status_ts) < STATUS_HEARTBEAT_SECONDS:
        return

    db.collection("vps_status").document(FOLLOWER_ID).set({
        **current,
        "vps_id": FOLLOWER_ID,
        "equity": ai.equity,
        "currency": ai.currency,
        "server": ai.server,
        "ts": int(now),
    }, merge=True)
    _last_published_status = current
    _last_published_status_ts = now


# Dernier contenu de _mirrored_tickets effectivement écrit dans Firestore —
# pour ne réécrire mirror_state que si ça a changé (voir _save_state).
_last_saved_tickets = None


def _load_state(db):
    global _mirrored_tickets, _last_saved_tickets
    doc = db.collection("mirror_state").document(FOLLOWER_ID).get()
    _mirrored_tickets = doc.to_dict().get("tickets", {}) if doc.exists else {}
    _last_saved_tickets = dict(_mirrored_tickets)


def _save_state(db):
    """N'écrit que si _mirrored_tickets a réellement changé depuis la
    dernière sauvegarde — sinon, un tour de boucle sans aucune ouverture,
    clôture ni annulation réécrivait quand même le même contenu."""
    global _last_saved_tickets
    if _mirrored_tickets == _last_saved_tickets:
        return
    db.collection("mirror_state").document(FOLLOWER_ID).set({"tickets": _mirrored_tickets})
    _last_saved_tickets = dict(_mirrored_tickets)


# task_id -> ticket suppléant (int), -1 si dry-run (pas de vrai ticket), ou
# None si le signal a été ignoré sans être exécuté (trop vieux, voir
# TASK_SIGNAL_MAX_AGE_SECONDS) — distinct de _mirrored_tickets : un signal
# de tâche n'est PAS une position mirroitée en continu (pas de SL/TP suivi
# ici une fois posé, contrairement au miroir USDJPY, voir
# _execute_task_signal), juste "déjà traité une fois, ne jamais retenter".
_handled_task_signals = {}
_last_saved_handled_signals = None

# Au-delà de cet âge, un signal de tâche est ignoré sans être exécuté (le
# prix d'entrée calculé au déclenchement est sans doute trop loin du marché
# actuel) — évite qu'activer une paire longtemps après coup ne déclenche
# soudainement l'exécution d'un signal très ancien. Même ordre de grandeur
# que SPREAD_WAIT_TIMEOUT_SECONDS côté tasks.py.
TASK_SIGNAL_MAX_AGE_SECONDS = 60 * 60


def _load_signal_state(db):
    global _handled_task_signals, _last_saved_handled_signals
    doc = db.collection("task_signal_state").document(FOLLOWER_ID).get()
    _handled_task_signals = doc.to_dict().get("handled", {}) if doc.exists else {}
    _last_saved_handled_signals = dict(_handled_task_signals)


def _save_signal_state(db):
    global _last_saved_handled_signals
    if _handled_task_signals == _last_saved_handled_signals:
        return
    db.collection("task_signal_state").document(FOLLOWER_ID).set({"handled": _handled_task_signals})
    _last_saved_handled_signals = dict(_handled_task_signals)


def _execute_task_signal(db, m, follower_account_size, task_id, signal):
    """Exécute un signal de tâche multi-actifs (task_signals/{task_id}, voir
    _publish_task_signal dans tasks.py) sur CE compte, SEULEMENT si CE
    compte a explicitement activé le symbole concerné — indépendamment de
    ce que MASTER fait (ou ne fait pas) sur son propre compte, voir la todo
    multi-actifs "exécution directe par tâche".

    Toujours un ordre EN ATTENTE (Buy/Sell Limit — scenario_shared.py ne
    produit jamais d'autre type de résultat, voir finish_buy_order/
    finish_sell_order/buy_1.py/sell_1.py), même convention que
    _open_pending_mirror (type_filling RETURN, magic/comment dédiés).

    PAS de gestion de trailing stop ici, volontairement : le miroir USDJPY
    suit le SL courant de MASTER (lui-même ajusté par trailing_stop.py) —
    mais il n'y a ici aucune position MASTER à suivre pour un symbole qu'il
    ne trade pas. Le SL/TP posé reste donc fixe. À construire séparément si
    besoin un jour (todo multi-actifs)."""
    symbol = signal["symbol"]
    settings = _resolve_symbol_settings(db, FOLLOWER_ID, symbol)
    if not settings["enabled"]:
        return  # pas activé sur ce compte — on retentera au prochain tour (coût négligeable, lecture en cache)

    lot = compute_follower_lot_by_strategy(
        db, m, follower_account_size, signal["entry"], signal["sl"], symbol=symbol
    )
    if lot is None:
        print(f"[SIGNAL] {task_id} ({symbol}) : stratégie de risque absente ou donnée manquante, réessai au prochain tour")
        return  # pas marqué "handled" : on retente tant que la donnée manque

    m.symbol_select(symbol, True)

    if DRY_RUN:
        print(f"[SIGNAL] (dry-run) ouvrirait {symbol} {signal['orderType']} lot={lot} @ {signal['entry']} (tâche {task_id})")
        _handled_task_signals[task_id] = -1
        return

    order_type = m.ORDER_TYPE_SELL_LIMIT if signal["orderType"] == "Sell Limit" else m.ORDER_TYPE_BUY_LIMIT
    res = m.order_send({
        "action": m.TRADE_ACTION_PENDING,
        "symbol": symbol,
        "volume": lot,
        "type": order_type,
        "price": float(signal["entry"]),
        "sl": float(signal["sl"]),
        "tp": float(signal["tp"]),
        "deviation": 20,
        "magic": MAGIC,
        "comment": f"signal-{task_id}"[:28],
        "type_time": m.ORDER_TIME_GTC,
        "type_filling": m.ORDER_FILLING_RETURN,
    })

    if res is None or res.retcode != m.TRADE_RETCODE_DONE:
        error = str(m.last_error()) if res is None else res.comment
        print(f"[SIGNAL] échec exécution du signal {task_id} ({symbol}) : {error}")
        return  # pas marqué "handled" : retenté au prochain tour (ex: marché fermé)

    _handled_task_signals[task_id] = res.order
    print(f"[SIGNAL] exécuté : {symbol} {signal['orderType']} lot={lot} ticket={res.order} (tâche {task_id})")


def _open_mirror(m, master_ticket, master_pos, lot):
    symbol = master_pos["symbol"]
    is_buy = master_pos["type"] == 0
    side = "Buy" if is_buy else "Sell"

    if DRY_RUN:
        print(f"[MIRROR] (dry-run) ouvrirait {symbol} {side} lot={lot} (source {master_ticket})")
        _mirrored_tickets[str(master_ticket)] = -1  # placeholder — pas de vrai ticket en dry-run
        return

    tick = m.symbol_info_tick(symbol)
    if tick is None:
        print(f"[MIRROR] impossible d'ouvrir le miroir de {master_ticket} : prix indisponible")
        return

    res = m.order_send({
        "action": m.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": lot,
        "type": m.ORDER_TYPE_BUY if is_buy else m.ORDER_TYPE_SELL,
        "price": tick.ask if is_buy else tick.bid,
        "sl": master_pos["sl"],
        "tp": master_pos["tp"],
        "deviation": 20,
        "magic": MAGIC,
        "comment": f"mirror-{master_ticket}"[:28],
        "type_time": m.ORDER_TIME_GTC,
        "type_filling": m.ORDER_FILLING_IOC,
    })

    if res is None or res.retcode != m.TRADE_RETCODE_DONE:
        error = str(m.last_error()) if res is None else res.comment
        print(f"[MIRROR] échec ouverture miroir de {master_ticket} : {error}")
        return

    _mirrored_tickets[str(master_ticket)] = res.order
    print(f"[MIRROR] ouvert : {symbol} {side} lot={lot} ticket={res.order} (source {master_ticket})")


def _update_mirror_sltp(m, follower_ticket, master_pos):
    res = m.order_send({
        "action": m.TRADE_ACTION_SLTP,
        "position": follower_ticket,
        "symbol": master_pos["symbol"],
        "sl": master_pos["sl"],
        "tp": master_pos["tp"],
    })
    if res is None or res.retcode != m.TRADE_RETCODE_DONE:
        error = str(m.last_error()) if res is None else res.comment
        print(f"[MIRROR] échec mise à jour SL/TP du miroir {follower_ticket} : {error}")
    else:
        print(f"[MIRROR] SL/TP du miroir {follower_ticket} aligné sur la source")


def _open_pending_mirror(m, master_ticket, master_order, lot):
    """Pose le même ordre différé (type, prix, SL/TP) côté suppléant, lot
    proraté. En mode Hedging, le ticket de cet ordre deviendra le ticket de
    la position une fois déclenché — donc _mirrored_tickets sert aux deux
    sans distinction, pas besoin d'un suivi séparé pour la transition."""
    symbol = master_order["symbol"]

    if DRY_RUN:
        print(
            f"[MIRROR] (dry-run) poserait un ordre différé {symbol} type={master_order['order_type']} "
            f"lot={lot} @ {master_order['entry']} (source {master_ticket})"
        )
        _mirrored_tickets[str(master_ticket)] = -1  # placeholder — pas de vrai ticket en dry-run
        return

    res = m.order_send({
        "action": m.TRADE_ACTION_PENDING,
        "symbol": symbol,
        "volume": lot,
        "type": master_order["order_type"],
        "price": master_order["entry"],
        "sl": master_order["sl"],
        "tp": master_order["tp"],
        "deviation": 20,
        "magic": MAGIC,
        "comment": f"mirror-{master_ticket}"[:28],
        "type_time": m.ORDER_TIME_GTC,
        "type_filling": m.ORDER_FILLING_RETURN,  # même convention que tasks.py pour les ordres différés
    })

    if res is None or res.retcode != m.TRADE_RETCODE_DONE:
        error = str(m.last_error()) if res is None else res.comment
        print(f"[MIRROR] échec pose ordre différé de {master_ticket} : {error}")
        return

    _mirrored_tickets[str(master_ticket)] = res.order
    print(
        f"[MIRROR] ordre différé posé : {symbol} type={master_order['order_type']} lot={lot} "
        f"@ {master_order['entry']} ticket={res.order} (source {master_ticket})"
    )


def _cancel_mirror_order(m, follower_ticket):
    res = m.order_send({"action": m.TRADE_ACTION_REMOVE, "order": follower_ticket})
    if res is None or res.retcode != m.TRADE_RETCODE_DONE:
        error = str(m.last_error()) if res is None else res.comment
        print(f"[MIRROR] échec annulation ordre différé {follower_ticket} : {error}")
    else:
        print(f"[MIRROR] ordre différé {follower_ticket} annulé")


def _close_mirror(m, follower_pos):
    is_buy = follower_pos.type == 0
    tick = m.symbol_info_tick(follower_pos.symbol)
    if tick is None:
        print(f"[MIRROR] impossible de fermer le miroir {follower_pos.ticket} : prix indisponible")
        return

    res = m.order_send({
        "action": m.TRADE_ACTION_DEAL,
        "position": follower_pos.ticket,
        "symbol": follower_pos.symbol,
        "volume": follower_pos.volume,
        "type": m.ORDER_TYPE_SELL if is_buy else m.ORDER_TYPE_BUY,
        "price": tick.bid if is_buy else tick.ask,
        "deviation": 20,
        "magic": MAGIC,
        "comment": "mirror-close",
        "type_time": m.ORDER_TIME_GTC,
        "type_filling": m.ORDER_FILLING_IOC,
    })
    if res is None or res.retcode != m.TRADE_RETCODE_DONE:
        error = str(m.last_error()) if res is None else res.comment
        print(f"[MIRROR] échec fermeture miroir {follower_pos.ticket} : {error}")
    else:
        print(f"[MIRROR] miroir {follower_pos.ticket} fermé")


def _is_pre_existing(master_ticket, master_state_doc):
    """True si ce ticket existait déjà côté principal avant le démarrage de
    ce process (voir le commentaire sur _follower_boot_time plus haut) —
    décision prise au cas par cas sur un vrai horodatage, puis mémorisée
    pour ne pas la refaire à chaque tour."""
    if master_ticket in _ignored_pre_existing_tickets:
        return True
    updated_at = master_state_doc.get("updated_at")
    if updated_at is not None and updated_at <= _follower_boot_time - PRE_EXISTING_GRACE_SECONDS:
        _ignored_pre_existing_tickets.add(master_ticket)
        print(f"[MIRROR] {master_ticket} déjà ouvert(e) avant le démarrage, ignoré(e) (pas de mirroring rétroactif)")
        return True
    return False


def check_account_order_requests(db, m):
    """Ordre manuel indépendant placé directement sur CE suppléant depuis le
    nouvel onglet "par compte" (account_order.py, partagé avec on_demand.py
    côté principal) — commands/account_order_request_{FOLLOWER_ID}. Ce
    process n'a sinon AUCUNE lecture de la collection commands (il ne fait
    que mirror) ; c'est la seule commande qu'il traite lui-même."""
    doc = db.collection("commands").document(command_doc_id(FOLLOWER_ID)).get()
    if not doc.exists or doc.to_dict().get("status") != "pending":
        return
    follower_account_size = _account_size(db, FOLLOWER_ID)
    handle_account_order_request(db, doc, m, FOLLOWER_ID, follower_account_size, MAGIC, DRY_RUN, PRICE_SYMBOL)


def sync_mirror(db):
    m = ensure_mt5(path=TERMINAL_PATH)
    if m is None:
        return

    check_account_order_requests(db, m)
    _publish_own_status(db, m)

    _start_master_state_listeners(db)
    with _master_state_lock:
        if not (_positions_ready and _orders_ready and _signals_ready):
            elapsed = time.time() - _listeners_started_at
            if elapsed > LISTENER_STARTUP_WARNING_SECONDS:
                print(
                    f"[MIRROR] ATTENTION : écouteur(s) Firestore toujours pas prêt(s) après {elapsed:.0f}s "
                    f"(positions_ready={_positions_ready} orders_ready={_orders_ready} signals_ready={_signals_ready}) — "
                    "vérifie la connexion réseau et les permissions Firestore, aucun mirroring en cours"
                )
            return  # écouteurs pas encore synchronisés, on attend
        master_positions = dict(_master_positions_cache)
        master_orders = dict(_master_orders_cache)
        task_signals = dict(_task_signals_cache)

    follower_positions = {p.ticket: p for p in (m.positions_get(symbol=PRICE_SYMBOL) or ())}
    follower_orders = {o.ticket: o for o in (m.orders_get(symbol=PRICE_SYMBOL) or ())}

    master_account_size = _account_size(db, MASTER_VPS_ID)
    follower_account_size = _account_size(db, FOLLOWER_ID)

    # 1a. Ouvrir les positions du compte principal pas encore miroitées (ni
    # déjà ouvertes avant le démarrage de ce process — voir _is_pre_existing).
    # Le lot suit TOUJOURS la Stratégie de risque de CE suppléant quand elle
    # est configurée (compute_follower_lot_by_strategy) — le prorata sur la
    # taille de compte (compute_follower_lot) n'est qu'un filet de secours
    # pour un suppléant en mode "manuel".
    for master_ticket, master_pos in master_positions.items():
        if master_ticket in _mirrored_tickets or _is_pre_existing(master_ticket, master_pos):
            continue
        lot = compute_follower_lot_by_strategy(db, m, follower_account_size, master_pos["entry"], master_pos["sl"])
        if lot is None:
            lot = compute_follower_lot(master_pos["volume"], master_account_size, follower_account_size)
        if lot is None:
            print(f"[MIRROR] account_size manquant (principal ou suppléant), position {master_ticket} ignorée pour l'instant")
            continue
        _open_mirror(m, master_ticket, master_pos, lot)

    # 1b. Poser les ordres différés du compte principal pas encore miroités.
    for master_ticket, master_order in master_orders.items():
        if master_ticket in _mirrored_tickets or _is_pre_existing(master_ticket, master_order):
            continue
        lot = compute_follower_lot_by_strategy(db, m, follower_account_size, master_order["entry"], master_order["sl"])
        if lot is None:
            lot = compute_follower_lot(master_order["volume"], master_account_size, follower_account_size)
        if lot is None:
            print(f"[MIRROR] account_size manquant (principal ou suppléant), ordre différé {master_ticket} ignoré pour l'instant")
            continue
        _open_pending_mirror(m, master_ticket, master_order, lot)

    # 2. Aligner le SL/TP des positions déjà miroitées, seulement si ça a
    # changé. Les ordres différés ne sont pas modifiés en place ici (juste
    # posés/annulés) — un changement de prix sur un ordre différé côté
    # compte principal n'est pas propagé, seulement son SL/TP une fois
    # devenu une position.
    for master_ticket, follower_ticket in list(_mirrored_tickets.items()):
        if follower_ticket == -1:
            continue  # placeholder dry-run
        master_pos = master_positions.get(master_ticket)
        if master_pos is None:
            continue  # pas (encore) une position — ordre différé, ou disparue (point 3)
        follower_pos = follower_positions.get(follower_ticket)
        if follower_pos is None:
            continue  # déjà fermé côté suppléant (SL/TP touché, ou manuellement)
        if follower_pos.sl != master_pos["sl"] or follower_pos.tp != master_pos["tp"]:
            _update_mirror_sltp(m, follower_ticket, master_pos)

    # 3. Fermer les miroirs (positions) ou annuler les miroirs (ordres
    # différés) dont la source a disparu. En mode Hedging, un ordre différé
    # déclenché garde le même ticket en devenant une position — donc "encore
    # ouvert" veut dire présent dans master_positions OU master_orders,
    # jamais les deux à vide en même temps sauf disparition réelle.
    for master_ticket in list(_mirrored_tickets):
        if master_ticket in master_positions or master_ticket in master_orders:
            continue

        follower_ticket = _mirrored_tickets[master_ticket]
        if follower_ticket != -1:
            follower_pos = follower_positions.get(follower_ticket)
            if follower_pos is not None:
                _close_mirror(m, follower_pos)
            elif follower_ticket in follower_orders:
                _cancel_mirror_order(m, follower_ticket)
        print(f"[MIRROR] position/ordre source {master_ticket} disparu(e), miroir retiré du suivi")
        del _mirrored_tickets[master_ticket]

    _save_state(db)

    # 4. Signaux de tâches multi-actifs (task_signals, voir tasks.py) — PAS
    # le miroir ci-dessus : pas la copie d'une position déjà ouverte sur
    # MASTER, mais l'exécution directe d'un ordre déclenché par une tâche,
    # pour les symboles que CE compte a explicitement activés (y compris des
    # symboles que MASTER lui-même ne trade jamais, voir la todo
    # multi-actifs "exécution directe par tâche").
    for task_id, signal in task_signals.items():
        if task_id in _handled_task_signals:
            continue
        age_seconds = time.time() - (signal.get("ts", 0) / 1000)
        if age_seconds > TASK_SIGNAL_MAX_AGE_SECONDS:
            _handled_task_signals[task_id] = None  # trop vieux, jamais exécuté, mais plus jamais retenté non plus
            continue
        _execute_task_signal(db, m, follower_account_size, task_id, signal)

    _save_signal_state(db)


if __name__ == "__main__":
    from google.cloud import firestore

    if not TERMINAL_PATH:
        raise SystemExit(
            "[ERREUR] follower_terminal_path.txt manquant — chemin complet vers le "
            "terminal64.exe du compte suppléant requis."
        )
    if not os.path.exists(SA_PATH):
        raise SystemExit(f"[ERREUR] {SA_PATH} introuvable.")

    _follower_boot_time = time.time()
    db = firestore.Client.from_service_account_json(SA_PATH)
    print(f"[BOOT] FOLLOWER_ID={FOLLOWER_ID} | terminal={TERMINAL_PATH} | dry_run={DRY_RUN} | poll={POLL_INTERVAL}s")

    # _load_state/_load_signal_state tournent AVANT la boucle principale, donc
    # AVANT son propre filet de sécurité (le except ResourceExhausted plus
    # bas) — un throttle Firestore actif pile au démarrage de CE process
    # tuerait sinon le process entier avant même d'avoir pu démarrer (observé
    # le 2026-11-13 : crash non rattrapé sur _load_state). Même logique de
    # pause que la boucle principale, en boucle jusqu'à ce que ça passe.
    for load_fn, label in ((_load_state, "_load_state"), (_load_signal_state, "_load_signal_state")):
        while True:
            try:
                load_fn(db)
                break
            except ResourceExhausted:
                print(f"[BOOT] Firestore throttle (429) pendant {label} — pause de {QUOTA_COOLDOWN_SECONDS}s avant de réessayer")
                time.sleep(QUOTA_COOLDOWN_SECONDS)

    while True:
        try:
            sync_mirror(db)
            time.sleep(POLL_INTERVAL)
        except ResourceExhausted:
            # Même logique que mt5_status.py (_run_safely) : un throttle
            # Firestore actif (429) ne se résout pas en retentant presque
            # immédiatement avec le même pic de requêtes (check_account_order_requests,
            # _publish_own_status, _account_size, les écouteurs...) — on
            # attend nettement plus longtemps avant de reprendre.
            print(
                f"[LOOP] Firestore throttle (429 ResourceExhausted) — pause de "
                f"{QUOTA_COOLDOWN_SECONDS}s avant de reprendre"
            )
            time.sleep(QUOTA_COOLDOWN_SECONDS)
        except Exception:
            print("[LOOP] erreur :")
            traceback.print_exc()
            time.sleep(POLL_INTERVAL)
