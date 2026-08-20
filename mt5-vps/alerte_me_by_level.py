#!/usr/bin/env python3
"""
alerte_me_by_level.py — Détecte, à chaque tour de boucle (~10s, pas lié aux
bougies — sinon une clôture met jusqu'à 4h à être remarquée), une position
qui vient de disparaître (fermée : SL, TP, manuelle...) et notifie son
résultat net en $ ainsi que la raison de clôture — réutilise _deals_to_trade
de trades.py (même logique fiable basée sur DEAL_REASON, pas de duplication
du calcul). Porte sur TOUTES les positions, pas seulement H1/H4 — SAUF
celles suivies par trailing_stop.py (doc trailing_levels/{ticket} existant),
qui notifie déjà leur propre clôture (TP/SL hit + net) ; sans cette
exclusion, une position suivie recevrait deux notifs de clôture distinctes
pour le même événement.

Le rapport de situation (progression vers TP/SL) et le trailing stop
vivaient ici aussi jusqu'à leur fusion dans trailing_stop.py — les deux
tournaient déjà sur le même déclencheur (bougie H1/H4 qui vient de se
terminer), contrairement à cette détection-ci qui doit rester réactive à
chaque tour, pas seulement au rythme des bougies.

Appelé depuis la boucle principale de mt5_status.py (comme tp_progress.py,
trailing_stop.py...) — PAS un process séparé : ça l'était avant, via
run_all.py, mais un déploiement qui ne lance que mt5_status.py (le cas le
plus courant) faisait alors silencieusement l'impasse sur cette notif.
"""

from datetime import datetime, timezone

from config import PRICE_SYMBOL
from mt5_client import ensure_mt5
from notify import notify
from trades import _deals_to_trade

# État en mémoire, propre à ce script (indépendant de _last_open_position_ids
# dans trades.py, qui tourne dans un autre process/boucle).
_last_open_tickets = None


def _check_closed_positions(db, m, positions):
    """Détecte les tickets ouverts au tour précédent et disparus à celui-ci
    (déjà récupérés ce tour-ci, pas de second appel MT5), et notifie leur
    résultat net (profit + swap + commission) en $ et la raison de clôture
    (SL/TP/CLIENT/...) — sauf les positions suivies par trailing_stop.py,
    qui s'en charge déjà avec un message combiné. Premier tour après
    démarrage : on mémorise l'état sans rien notifier."""
    global _last_open_tickets
    current_tickets = {p.ticket for p in positions}

    if _last_open_tickets is None:
        _last_open_tickets = current_tickets
        return

    closed_tickets = _last_open_tickets - current_tickets
    for ticket in closed_tickets:
        if db.collection("trailing_levels").document(str(ticket)).get().exists:
            continue  # déjà notifié par trailing_stop.py (_check_closed)

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


def check_closed_positions_notify(db):
    """Point d'entrée appelé depuis la boucle de mt5_status.py — même pattern
    que les autres check_*(db) (tp_progress, trailing_stop...)."""
    m = ensure_mt5()
    if m is None:
        return

    positions = m.positions_get(symbol=PRICE_SYMBOL) or ()
    _check_closed_positions(db, m, positions)
