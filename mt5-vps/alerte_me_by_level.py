#!/usr/bin/env python3
"""
alerte_me_by_level.py — Toutes les 15 minutes, situe chaque position USDJPY
ouverte par rapport à son entrée (PE), son TP et son SL, au close de la
dernière bougie M15 clôturée : progression exacte vers le TP (si le close
est du côté profit) ou vers le SL (si du côté perte), notifiée à chaque
vérification — pas de seuils fixes, le pourcentage exact à chaque fois.

Détecte aussi, au même rythme, une position qui vient de disparaître
(fermée : SL, TP, manuelle...) et notifie son résultat net en $ ainsi que
la raison de clôture — réutilise _deals_to_trade de trades.py (même
logique fiable basée sur DEAL_REASON, pas de duplication du calcul).
"""

import time
import traceback
from datetime import datetime, timezone

from config import MASTER_TERMINAL_PATH, PRICE_SYMBOL
from mt5_client import ensure_mt5, set_default_path
from notify import notify
from trades import _deals_to_trade

CHECK_INTERVAL_SECONDS = 15 * 60

# État en mémoire, propre à ce script (indépendant de _last_open_position_ids
# dans trades.py, qui tourne dans un autre process/boucle).
_last_open_tickets = None


def get_m15_close(m, symbol):
    """Close de la dernière bougie M15 clôturée (position 1 = celle qui
    vient de se terminer, pas la bougie en cours de formation)."""
    m.symbol_select(symbol, True)
    rates = m.copy_rates_from_pos(symbol, m.TIMEFRAME_M15, 1, 1)
    if rates is None or len(rates) == 0:
        return None
    return float(rates[0]["close"])


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


def _run_once():
    m = ensure_mt5()
    if m is None:
        return

    now = datetime.now(timezone.utc).strftime("%H:%M:%S")
    positions = m.positions_get(symbol=PRICE_SYMBOL) or ()

    close = get_m15_close(m, PRICE_SYMBOL)
    if close is None:
        print(f"[{now}] bougie M15 introuvable")
    else:
        for pos in positions:
            label, pct = _position_progress(pos, close)
            if label is None:
                continue
            notify(
                f"mymt5 — on est à {pct:.2f}% du {label}",
                f"{pos.symbol} (ticket {pos.ticket}) : close {close}, entrée {pos.price_open}",
            )
            print(f"[{now}] ticket {pos.ticket} : {pct:.2f}% du {label} (close {close})")

    _check_closed_positions(m, positions)


if __name__ == "__main__":
    # Indispensable dès qu'un deuxième terminal MT5 tourne sur la machine
    # (compte suppléant) — sans ça, la connexion peut se faire au hasard sur
    # le mauvais terminal (voir mt5_client.py).
    set_default_path(MASTER_TERMINAL_PATH)

    while True:
        try:
            _run_once()
        except Exception:
            print("[LOOP] erreur :")
            traceback.print_exc()
        time.sleep(CHECK_INTERVAL_SECONDS)
