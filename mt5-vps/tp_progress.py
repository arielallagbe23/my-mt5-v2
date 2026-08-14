"""
tp_progress.py — Notifie la progression d'une position ouverte vers son TP
(50% / 75% / 95% / TP atteint), pour les positions issues d'une tâche H1 ou
H4 uniquement. Vérifié toutes les 15 minutes, à partir du pic (high/low) de
la dernière bougie clôturée du timeframe concerné. Chaque seuil n'est
notifié qu'une fois par position.
"""

from datetime import datetime, timezone

from config import PRICE_SYMBOL
from mt5_client import ensure_mt5
from notify import notify
from position_shared import (
    ELIGIBLE_TIMEFRAMES,
    POSITION_TYPE_NAMES,
    candle_peak,
    candles_current_and_previous,
    forget_closed_timeframes,
    resolve_timeframe,
)

PROGRESS_THRESHOLDS = [50, 75, 95, 100]
PROGRESS_CHECK_INTERVAL_SECONDS = 15 * 60  # 15 minutes
_last_progress_check = None

# ticket -> ensemble des seuils déjà notifiés pour cette position.
_notified_thresholds = {}


def check_tp_progress(db):
    """Vérifié toutes les 15 minutes (une simple minuterie, pas liée à une
    détection de nouvelle bougie) — à partir du pic (high/low) de la
    dernière bougie clôturée du timeframe de la position, pas du prix live.

    Note : le seuil 100% (TP atteint) peut ne jamais se déclencher depuis
    cette fonction en pratique — dès que le TP est vraiment touché, MT5 clôt
    la position automatiquement, donc elle risque de disparaître de
    positions_get() avant même qu'on la voie à ~100%. Une détection fiable
    de "position fermée au TP" nécessiterait de regarder l'historique des
    deals plutôt que les positions ouvertes — pas fait ici, à ajouter si ce
    seuil s'avère peu fiable en pratique.
    """
    global _last_progress_check
    now_utc = datetime.now(timezone.utc)
    if (
        _last_progress_check is not None
        and (now_utc - _last_progress_check).total_seconds() < PROGRESS_CHECK_INTERVAL_SECONDS
    ):
        return
    _last_progress_check = now_utc

    m = ensure_mt5()
    if m is None:
        return

    positions = m.positions_get(symbol=PRICE_SYMBOL) or ()

    for pos in positions:
        ticket = pos.ticket
        tp = pos.tp
        if not tp:
            continue  # pas de TP défini sur cette position, rien à mesurer

        timeframe = resolve_timeframe(db, ticket, pos.comment)
        if timeframe not in ELIGIBLE_TIMEFRAMES:
            continue

        previous_bar, _ = candles_current_and_previous(m, pos.symbol, timeframe)
        if previous_bar is None:
            continue

        entry = pos.price_open
        peak = candle_peak(pos, previous_bar)
        total_distance = abs(tp - entry)
        if not total_distance:
            continue

        progress = abs(peak - entry) / total_distance * 100
        already_notified = _notified_thresholds.setdefault(ticket, set())

        for threshold in PROGRESS_THRESHOLDS:
            if progress >= threshold and threshold not in already_notified:
                side = POSITION_TYPE_NAMES.get(pos.type, str(pos.type))
                label = "TP atteint" if threshold == 100 else f"{threshold}% du chemin vers le TP"
                notify(
                    f"mymt5 — {label}",
                    f"{pos.symbol} {side} (ticket {ticket}) : pic {peak:.3f}, entrée {entry:.3f}, TP {tp:.3f}",
                )
                already_notified.add(threshold)
                print(f"[TP] ticket {ticket} : {label} (pic {peak:.3f})")

    # Nettoyage : une position fermée (SL, TP, manuelle...) ne doit pas rester
    # indéfiniment en mémoire.
    current_tickets = {p.ticket for p in positions}
    for ticket in list(_notified_thresholds):
        if ticket not in current_tickets:
            del _notified_thresholds[ticket]
    forget_closed_timeframes(current_tickets)
