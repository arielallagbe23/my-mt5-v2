"""
trades.py — Historique des trades fermés, pour le Journal.

  - handle_trades_sync_request : appelé par on_demand.py (requête groupée
    commands/), récupère TOUT l'historique de deals MT5 et écrit un doc
    trades/{positionId} par position fermée — utilisé pour l'import initial
    et pour un rafraîchissement manuel depuis l'app.
  - check_closed_positions : en continu à chaque tour de boucle, détecte
    quand une position ouverte disparaît (fermée — SL, TP, manuelle...) et
    écrit son trade automatiquement, sans action de l'utilisateur. Une fois
    l'import initial fait, plus jamais besoin de resynchroniser à la main.

Les deux partagent _deals_to_trade, qui utilise le champ `reason` fourni par
MT5 (DEAL_REASON_SL/TP/...) pour classer le résultat — fiable, contrairement
à deviner depuis le texte du commentaire (ça varie selon le broker/l'EA).
"""

import time
from datetime import datetime, timedelta, timezone

from config import PRICE_SYMBOL
from mt5_client import ensure_mt5


def _reason_name(m, reason):
    names = {
        m.DEAL_REASON_CLIENT: "CLIENT",
        m.DEAL_REASON_MOBILE: "MOBILE",
        m.DEAL_REASON_WEB: "WEB",
        m.DEAL_REASON_EXPERT: "EXPERT",
        m.DEAL_REASON_SL: "SL",
        m.DEAL_REASON_TP: "TP",
        m.DEAL_REASON_SO: "STOP_OUT",
    }
    return names.get(reason, str(reason))


def _deals_to_trade(m, position_id, deals):
    """Construit un enregistrement de trade à partir des deals MT5 d'une
    même position fermée. Retourne None si les deals ne forment pas une
    paire entrée/sortie complète (position encore ouverte, deals de type
    BALANCE parasites, données incohérentes...).

    Gère les clôtures PARTIELLES (plusieurs deals de sortie) : avant, seul
    le PREMIER deal de sortie (next(...)) était utilisé — un trade clôturé
    en 2 fois se retrouvait tronqué à sa première moitié (mauvais volume,
    mauvais prix, et closeTime figée sur la première sortie au lieu de la
    dernière, donc la position semblait fermée bien avant qu'elle ne le
    soit réellement). Maintenant : volume total et prix moyen pondéré sur
    TOUTES les sorties, closeTime/reason/comment pris sur la DERNIÈRE (celle
    qui a réellement vidé la position). profit/swap/commission étaient déjà
    sommés sur tous les deals, donc déjà corrects même avant ce fix."""
    in_deal = next((d for d in deals if d.entry == m.DEAL_ENTRY_IN), None)
    out_deals = [d for d in deals if d.entry in (m.DEAL_ENTRY_OUT, m.DEAL_ENTRY_OUT_BY)]
    if in_deal is None or not out_deals:
        return None

    last_out = max(out_deals, key=lambda d: d.time)
    total_out_volume = sum(d.volume for d in out_deals)
    avg_close_price = (
        sum(d.price * d.volume for d in out_deals) / total_out_volume if total_out_volume else last_out.price
    )

    profit = sum(d.profit for d in deals)
    swap = sum(d.swap for d in deals)
    commission = sum(d.commission for d in deals)

    return {
        "positionId": position_id,
        "symbol": last_out.symbol,
        "type": "Buy" if in_deal.type == m.DEAL_TYPE_BUY else "Sell",
        "volume": total_out_volume,
        "priceOpen": in_deal.price,
        "priceClose": avg_close_price,
        "profit": profit,
        "swap": swap,
        "commission": commission,
        "net": profit + swap + commission,
        "openTime": int(in_deal.time),
        "closeTime": int(last_out.time),
        "reason": _reason_name(m, last_out.reason),
        "comment": last_out.comment,
        "ts": int(time.time()),
    }


def handle_trades_sync_request(db, doc):
    """Réimporte tout l'historique de deals MT5 — import initial ou
    rafraîchissement manuel demandé depuis l'app (bouton "Actualiser" qui,
    cette fois, écoute vraiment côté VPS). Appelé par on_demand.py's
    check_all_requests, qui a déjà récupéré `doc` dans sa requête groupée."""
    ref = doc.reference
    m = ensure_mt5()
    if m is None:
        return

    date_from = datetime(2000, 1, 1, tzinfo=timezone.utc)
    date_to = datetime.now(timezone.utc) + timedelta(days=1)
    deals = m.history_deals_get(date_from, date_to) or ()

    by_position = {}
    for d in deals:
        by_position.setdefault(d.position_id, []).append(d)

    written = 0
    for position_id, position_deals in by_position.items():
        trade = _deals_to_trade(m, position_id, position_deals)
        if trade is None:
            continue
        db.collection("trades").document(str(position_id)).set(trade)
        written += 1

    ref.update({"status": "done"})
    print(f"[TRADES] synchronisation complète : {written} trade(s) écrits sur {len(by_position)} position(s) vues")


# Ensemble en mémoire des tickets de positions ouvertes au tour précédent —
# état dédié à ce fichier (indépendant de ceux d'order_fills.py,
# untracked_positions.py, tp_progress.py, trailing_stop.py), pour ne pas
# dépendre de l'ordre d'exécution des fonctions dans la boucle.
_last_open_position_ids = None


def check_closed_positions(db):
    """Détecte automatiquement une position qui vient de se fermer (SL, TP,
    manuelle...) et écrit son trade. Premier tour après démarrage : on
    mémorise l'état sans rien écrire (l'import initial est le rôle de
    check_trades_sync_request, pas de celui-ci)."""
    global _last_open_position_ids

    m = ensure_mt5()
    if m is None:
        return

    positions = m.positions_get(symbol=PRICE_SYMBOL) or ()
    current_ids = {p.ticket for p in positions}

    if _last_open_position_ids is None:
        _last_open_position_ids = current_ids
        return

    closed_ids = _last_open_position_ids - current_ids
    for position_id in closed_ids:
        deals = m.history_deals_get(position=position_id) or ()
        trade = _deals_to_trade(m, position_id, deals)
        if trade is None:
            print(f"[TRADES] position {position_id} fermée mais deals introuvables, ignorée")
            continue
        db.collection("trades").document(str(position_id)).set(trade)
        print(f"[TRADES] position {position_id} fermée : net={trade['net']:.2f} ({trade['reason']})")

    _last_open_position_ids = current_ids
