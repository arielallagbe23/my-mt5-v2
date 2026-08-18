#!/usr/bin/env python3
"""
mirror_follower.py — Process SÉPARÉ pour un compte suppléant : reproduit en
quasi temps réel les positions USDJPY publiées par mirror_publish.py (compte
principal), avec un lot recalculé au prorata de l'account_size de CE
compte-ci (voir compute_follower_lot) — jamais un recalcul indépendant du
risque, un simple prorata sur la taille de compte, relu à chaque tour (pas
mis en cache) pour s'adapter automatiquement si un palier change (challenge
validé, scaling plan...).

Aucune décision de trading ici : ce compte ne fait qu'imiter le compte
principal (ouverture, ajustement SL/TP, clôture), jamais évaluer de
scénario lui-même — le compte principal reste le seul "cerveau".

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
import time

from mt5_client import ensure_mt5

_DIR = os.path.dirname(os.path.abspath(__file__))


def _read(name, default=None):
    path = os.path.join(_DIR, name)
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return f.read().strip()


FOLLOWER_ID = _read("follower_id.txt") or os.environ.get("FOLLOWER_ID", "account2")
TERMINAL_PATH = _read("follower_terminal_path.txt") or os.environ.get("FOLLOWER_TERMINAL_PATH")
DRY_RUN = (_read("follower_dry_run.txt") or os.environ.get("FOLLOWER_DRY_RUN", "true")).strip().lower() != "false"
MASTER_VPS_ID = _read("master_vps_id.txt") or os.environ.get("MASTER_VPS_ID", "main")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "10"))
SA_PATH = os.path.join(_DIR, "service-account.json")

PRICE_SYMBOL = "USDJPY"
MAGIC = 234100  # différent du MAGIC du compte principal (234000)

# ticket compte principal (str) -> ticket compte suppléant (int, ou -1 en
# DRY_RUN — pas de vrai ticket). Persisté dans Firestore (mirror_state) pour
# survivre à un redémarrage de ce process.
_mirrored_tickets = {}


def _account_size(db, vps_id):
    """Même logique que _account_size dans tasks.py, mais paramétrée par
    vps_id — le compte principal et le suppléant ont chacun le leur."""
    doc = db.collection("vps_status").document(vps_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict()
    login = data.get("login")
    entry = (data.get("accounts") or {}).get(str(login)) or {}
    return entry.get("account_size")


def compute_follower_lot(master_volume, master_account_size, follower_account_size):
    """Prorata simple sur l'account_size — le lot suit le même ratio que
    les tailles de compte (compte suppléant deux fois plus gros -> lot
    doublé), pas un recalcul indépendant du risque à partir de l'entrée/SL."""
    if not master_account_size or not follower_account_size or not master_volume:
        return None
    ratio = follower_account_size / master_account_size
    return max(0.01, round(master_volume * ratio, 2))


def _publish_own_status(db, m):
    """Publie équité/login du suppléant — même forme de doc que le compte
    principal (vps_status/{VPS_ID}), juste sous FOLLOWER_ID. _account_size
    lit le champ `login` de ce doc pour retrouver le bon account_size."""
    ai = m.account_info()
    if ai is None:
        return
    db.collection("vps_status").document(FOLLOWER_ID).set({
        "online": True,
        "vps_id": FOLLOWER_ID,
        "login": ai.login,
        "equity": ai.equity,
        "currency": ai.currency,
        "server": ai.server,
        "ts": int(time.time()),
    }, merge=True)


def _load_state(db):
    global _mirrored_tickets
    doc = db.collection("mirror_state").document(FOLLOWER_ID).get()
    _mirrored_tickets = doc.to_dict().get("tickets", {}) if doc.exists else {}


def _save_state(db):
    db.collection("mirror_state").document(FOLLOWER_ID).set({"tickets": _mirrored_tickets})


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


def sync_mirror(db):
    m = ensure_mt5(path=TERMINAL_PATH)
    if m is None:
        return

    _publish_own_status(db, m)

    master_positions = {}
    for doc in db.collection("mirror_positions").stream():
        data = doc.to_dict()
        master_positions[str(data["ticket"])] = data

    follower_positions = {p.ticket: p for p in (m.positions_get(symbol=PRICE_SYMBOL) or ())}

    master_account_size = _account_size(db, MASTER_VPS_ID)
    follower_account_size = _account_size(db, FOLLOWER_ID)

    # 1. Ouvrir les positions du compte principal pas encore miroitées.
    for master_ticket, master_pos in master_positions.items():
        if master_ticket in _mirrored_tickets:
            continue
        lot = compute_follower_lot(master_pos["volume"], master_account_size, follower_account_size)
        if lot is None:
            print(f"[MIRROR] account_size manquant (principal ou suppléant), position {master_ticket} ignorée pour l'instant")
            continue
        _open_mirror(m, master_ticket, master_pos, lot)

    # 2. Aligner le SL/TP des positions déjà miroitées, seulement si ça a changé.
    for master_ticket, follower_ticket in list(_mirrored_tickets.items()):
        if follower_ticket == -1:
            continue  # placeholder dry-run
        master_pos = master_positions.get(master_ticket)
        if master_pos is None:
            continue  # traité au point 3 (fermeture)
        follower_pos = follower_positions.get(follower_ticket)
        if follower_pos is None:
            continue  # déjà fermé côté suppléant (SL/TP touché, ou manuellement)
        if follower_pos.sl != master_pos["sl"] or follower_pos.tp != master_pos["tp"]:
            _update_mirror_sltp(m, follower_ticket, master_pos)

    # 3. Fermer les miroirs dont la position source a disparu.
    for master_ticket in list(_mirrored_tickets):
        if master_ticket in master_positions:
            continue
        follower_ticket = _mirrored_tickets[master_ticket]
        if follower_ticket != -1:
            follower_pos = follower_positions.get(follower_ticket)
            if follower_pos is not None:
                _close_mirror(m, follower_pos)
        print(f"[MIRROR] position source {master_ticket} fermée, miroir retiré du suivi")
        del _mirrored_tickets[master_ticket]

    _save_state(db)


if __name__ == "__main__":
    from google.cloud import firestore

    if not TERMINAL_PATH:
        raise SystemExit(
            "[ERREUR] follower_terminal_path.txt manquant — chemin complet vers le "
            "terminal64.exe du compte suppléant requis."
        )
    if not os.path.exists(SA_PATH):
        raise SystemExit(f"[ERREUR] {SA_PATH} introuvable.")

    db = firestore.Client.from_service_account_json(SA_PATH)
    print(f"[BOOT] FOLLOWER_ID={FOLLOWER_ID} | terminal={TERMINAL_PATH} | dry_run={DRY_RUN} | poll={POLL_INTERVAL}s")
    _load_state(db)

    while True:
        try:
            sync_mirror(db)
        except Exception as e:
            print(f"[LOOP] erreur : {e}")
        time.sleep(POLL_INTERVAL)
