"""
hourly_update.py — Envoie un point toutes les heures pour chaque position
suivie (H1/H4) : niveau actuel (progression signée, basée sur la clôture de
la dernière bougie de son propre timeframe) et palier de SL en place.
Purement informatif — contrairement à trailing_stop.py, ne modifie jamais
le SL, et n'est pas lié aux clôtures de bougie (simple minuterie horaire).
"""

from datetime import datetime, timezone

from config import PRICE_SYMBOL
from mt5_client import ensure_mt5
from notify import notify
from position_shared import (
    ELIGIBLE_TIMEFRAMES,
    POSITION_TYPE_NAMES,
    candles_current_and_previous,
    resolve_timeframe,
    signed_progress,
)
from trailing_stop import _sl_applied

HOURLY_UPDATE_INTERVAL_SECONDS = 60 * 60
_last_hourly_update = None

STAGE_LABELS = {-1: "aucun palier atteint", 0: "BE", 25: "25%", 50: "50%"}


def check_hourly_update(db):
    """Une simple minuterie, indépendante des bougies elles-mêmes —
    contrairement à check_trailing_stop qui n'agit qu'à la clôture d'une
    bougie, ce point est purement informatif."""
    global _last_hourly_update
    now_utc = datetime.now(timezone.utc)
    if (
        _last_hourly_update is not None
        and (now_utc - _last_hourly_update).total_seconds() < HOURLY_UPDATE_INTERVAL_SECONDS
    ):
        return
    _last_hourly_update = now_utc

    m = ensure_mt5()
    if m is None:
        return

    positions = m.positions_get(symbol=PRICE_SYMBOL) or ()
    for pos in positions:
        ticket = pos.ticket
        if not pos.tp:
            continue

        timeframe = resolve_timeframe(db, ticket, pos.comment)
        if timeframe not in ELIGIBLE_TIMEFRAMES:
            continue

        previous_bar, _ = candles_current_and_previous(m, pos.symbol, timeframe)
        if previous_bar is None:
            continue

        close = float(previous_bar["close"])
        progress = signed_progress(pos, close)
        if progress is None:
            continue

        side = POSITION_TYPE_NAMES.get(pos.type, str(pos.type))
        stage_label = STAGE_LABELS.get(_sl_applied.get(ticket, -1), "aucun palier atteint")

        notify(
            f"mymt5 — point horaire (ticket {ticket})",
            f"{pos.symbol} {side} : {progress:.0f}% du chemin vers le TP (clôture {close:.3f}), SL au palier {stage_label}",
        )
        print(f"[HOURLY] ticket {ticket} : {progress:.0f}%, palier {stage_label}")
