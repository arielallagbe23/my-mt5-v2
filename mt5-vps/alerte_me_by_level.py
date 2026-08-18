#!/usr/bin/env python3
"""
alerte_me_by_level.py — Situe chaque position USDJPY suivie (H1/H4, même
timeframe que trailing_stop.py) par rapport à son entrée (PE), son TP et
son SL, au close de la bougie H1/H4 qui vient de se terminer : progression
exacte vers le TP (si le close est du côté profit) ou vers le SL (si du
côté perte). Ne notifie qu'UNE FOIS par nouvelle bougie H1/H4 de la
position — même rythme que le trailing stop, pour éviter le flot de
notifications qu'un minuteur fixe (15 min, jusqu'à 4 notifs/heure/position)
donnait. Conséquence assumée : les positions sans timeframe H1/H4 résolu
(jamais suivies, ni par une tâche ni activées à la main) ne sont plus
concernées par cette notif — exactement le même périmètre que le trailing
stop, par cohérence.

Détecte aussi, à chaque tour de boucle (~10s, pas lié aux bougies — sinon
une clôture met jusqu'à 4h à être remarquée), une position qui vient de
disparaître (fermée : SL, TP, manuelle...) et notifie son résultat net en
$ ainsi que la raison de clôture — réutilise _deals_to_trade de trades.py
(même logique fiable basée sur DEAL_REASON, pas de duplication du calcul).
Ce suivi-là reste sur TOUTES les positions, pas seulement H1/H4.
"""

import os
import time
import traceback
from datetime import datetime, timedelta, timezone

from config import MASTER_TERMINAL_PATH, PRICE_SYMBOL, SA_PATH
from mt5_client import ensure_mt5, set_default_path
from notify import notify
from position_shared import ELIGIBLE_TIMEFRAMES, candles_current_and_previous, resolve_timeframe
from trades import _deals_to_trade

POLL_INTERVAL = 10
SAFETY_DELAY_SECONDS = 2  # même précaution que trailing_stop.py après l'ouverture d'une nouvelle bougie

# État en mémoire, propre à ce script (indépendant de _last_open_position_ids
# dans trades.py, qui tourne dans un autre process/boucle).
_last_open_tickets = None

# timeframe -> candle_time de la dernière bougie déjà traitée pour la
# notif de progression — même mécanisme que trailing_stop.py.
_last_processed_candle_time = {}


def _position_progress(pos, close):
    """Situe le close par rapport à PE/TP/SL : soit vers le TP (profit),
    soit vers le SL (perte), jamais les deux. Retourne (label, pct) avec
    label "TP" ou "SL", ou (None, 0) si le close est exactement à l'entrée
    ou si le niveau concerné (TP/SL) n'est pas défini sur la position."""
    entry = pos.price_open
    direction = 1 if pos.type == 0 else -1  # POSITION_TYPE_BUY == 0
    diff = (close - entry) * direction  # >0 vers le TP, <0 vers le SL

    if diff > 0 and pos.tp:
        return "TP", diff / abs(pos.tp - entry) * 100
    if diff < 0 and pos.sl:
        return "SL", abs(diff) / abs(pos.sl - entry) * 100
    return None, 0


def _check_progress(db, m, positions):
    """Notifie la progression TP/SL, une seule fois par nouvelle bougie
    H1/H4 — même détection qu'en trailing_stop.py (nouvelle bougie + délai
    de sécurité de 2s), appliquée séparément à chaque timeframe."""
    now_utc = datetime.now(timezone.utc)

    for timeframe in ELIGIBLE_TIMEFRAMES:
        previous_bar, current_bar = candles_current_and_previous(m, PRICE_SYMBOL, timeframe)
        if previous_bar is None:
            continue

        current_time = int(current_bar["time"])
        if _last_processed_candle_time.get(timeframe) == current_time:
            continue  # déjà traité pour cette bougie

        candle_open = datetime.fromtimestamp(current_time, tz=timezone.utc)
        if now_utc < candle_open + timedelta(seconds=SAFETY_DELAY_SECONDS):
            continue  # trop tôt, on retente au tour suivant

        _last_processed_candle_time[timeframe] = current_time
        close = float(previous_bar["close"])
        now_str = now_utc.strftime("%H:%M:%S")

        for pos in positions:
            if resolve_timeframe(db, pos.ticket, pos.comment) != timeframe:
                continue
            label, pct = _position_progress(pos, close)
            if label is None:
                continue
            notify(
                f"mymt5 — on est à {pct:.2f}% du {label}",
                f"{pos.symbol} (ticket {pos.ticket}) : close {close}, entrée {pos.price_open}",
            )
            print(f"[{now_str}] ticket {pos.ticket} : {pct:.2f}% du {label} (close {close})")


def _check_closed_positions(m, positions):
    """Détecte les tickets ouverts au tour précédent et disparus à celui-ci
    (déjà récupérés ce tour-ci, pas de second appel MT5), et notifie leur
    résultat net (profit + swap + commission) en $ et la raison de clôture
    (SL/TP/CLIENT/...). Premier tour après démarrage : on mémorise l'état
    sans rien notifier."""
    global _last_open_tickets
    current_tickets = {p.ticket for p in positions}

    if _last_open_tickets is None:
        _last_open_tickets = current_tickets
        return

    closed_tickets = _last_open_tickets - current_tickets
    for ticket in closed_tickets:
        deals = m.history_deals_get(position=ticket) or ()
        trade = _deals_to_trade(m, ticket, deals)
        if trade is None:
            continue

        net = trade["net"]
        sign = "+" if net >= 0 else ""
        notify(
            f"mymt5 — position fermée ({trade['reason']})",
            f"{trade['symbol']} (ticket {ticket}) : {sign}{net:.2f}$ ({trade['reason']})",
        )
        print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] ticket {ticket} fermé : {sign}{net:.2f}$ ({trade['reason']})")

    _last_open_tickets = current_tickets


def _run_once(db):
    m = ensure_mt5()
    if m is None:
        return

    positions = m.positions_get(symbol=PRICE_SYMBOL) or ()
    _check_progress(db, m, positions)
    _check_closed_positions(m, positions)


if __name__ == "__main__":
    from google.cloud import firestore

    # Indispensable dès qu'un deuxième terminal MT5 tourne sur la machine
    # (compte suppléant) — sans ça, la connexion peut se faire au hasard sur
    # le mauvais terminal (voir mt5_client.py).
    set_default_path(MASTER_TERMINAL_PATH)

    if not os.path.exists(SA_PATH):
        raise SystemExit(f"[ERREUR] {SA_PATH} introuvable.")

    db = firestore.Client.from_service_account_json(SA_PATH)

    while True:
        try:
            _run_once(db)
        except Exception:
            print("[LOOP] erreur :")
            traceback.print_exc()
        time.sleep(POLL_INTERVAL)
