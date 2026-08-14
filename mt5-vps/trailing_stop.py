"""
trailing_stop.py — Déplace le SL par paliers (BE à 50%, 25% à 75%, 50% à
95%), en se basant sur la CLÔTURE de la bougie H1/H4 qui vient de se
terminer — pas son pic (high/low), et pas le prix live en continu. Le pic
seul est trompeur : une bougie H4 peut toucher +75% en intra-bougie puis
clôturer à -10%, et un calcul basé sur le pic aurait quand même déplacé le
SL comme si +75% avait tenu. Avec la clôture et une progression signée
(pas de valeur absolue), une clôture en perte ne déclenche jamais aucun
palier — la position est simplement laissée telle quelle, à réévaluer à la
bougie suivante. Respecte DRY_RUN comme le reste du VPS.
"""

from datetime import datetime, timedelta, timezone

from config import DRY_RUN, PRICE_SYMBOL
from mt5_client import ensure_mt5
from notify import notify
from position_shared import (
    ELIGIBLE_TIMEFRAMES,
    POSITION_TYPE_NAMES,
    candles_current_and_previous,
    forget_closed_timeframes,
    resolve_timeframe,
    signed_progress,
)

# Palier de progression -> % du chemin entrée→TP où placer le SL. 50% de
# progression -> SL à BE (0%) ; 75% -> 25% ; 95% -> 50%. Parcourue du plus
# haut palier au plus bas pour ne retenir que le plus avancé atteint.
SL_STAGES = [(95, 50), (75, 25), (50, 0)]

SAFETY_DELAY_SECONDS = 2  # attendre un peu après l'ouverture d'une nouvelle bougie avant de la lire

# timeframe -> candle_time de la dernière bougie déjà traitée pour ce
# timeframe (H1 ou H4) — permet de ne travailler qu'une fois par bougie.
_last_processed_candle_time = {}

# ticket -> target_pct déjà appliqué (le plus avancé) : évite de repasser
# deux fois le même palier ou de reculer le SL.
_sl_applied = {}


def check_trailing_stop(db):
    """Ne travaille qu'UNE FOIS par nouvelle bougie H1/H4 (pas à chaque tour
    de boucle, ~10s) : on détecte qu'une nouvelle bougie vient d'apparaître,
    on attend un petit délai de sécurité (2s) après son ouverture pour être
    sûr que la précédente est bien finalisée côté MT5, puis on lit sa
    clôture. Comme le contrôle n'a lieu qu'une fois par bougie, un palier
    franchi est automatiquement appliqué "à la bougie suivante" par
    construction.

    Limite acceptée : si order_send échoue, on ne retente qu'à la bougie
    suivante — un échec isolé n'est pas critique puisque le SL en place
    reste valide en attendant.
    """
    m = ensure_mt5()
    if m is None:
        return

    now_utc = datetime.now(timezone.utc)
    positions_fetched = None  # ne sert qu'au nettoyage en fin de fonction

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

        positions_fetched = m.positions_get(symbol=PRICE_SYMBOL) or ()
        for pos in positions_fetched:
            ticket = pos.ticket
            tp = pos.tp
            if not tp:
                continue

            if resolve_timeframe(db, ticket, pos.comment) != timeframe:
                continue

            entry = pos.price_open
            close = float(previous_bar["close"])
            progress = signed_progress(pos, close)
            if progress is None:
                continue

            applied = _sl_applied.get(ticket, -1)

            target_pct = None
            for threshold, pct in SL_STAGES:
                if progress >= threshold and pct > applied:
                    target_pct = pct
                    break
            if target_pct is None:
                continue

            new_sl = entry + (tp - entry) * (target_pct / 100)
            side = POSITION_TYPE_NAMES.get(pos.type, str(pos.type))
            label = "BE" if target_pct == 0 else f"{target_pct}%"

            if DRY_RUN:
                # Jamais d'order_send réel en DRY_RUN — on notifie ce qui
                # aurait été fait et on marque le palier comme "appliqué"
                # pour ne pas renotifier à la prochaine bougie.
                notify(
                    f"mymt5 — [DRY-RUN] SL aurait été déplacé ({label})",
                    f"{pos.symbol} {side} (ticket {ticket}) : nouveau SL {new_sl:.3f} (clôture bougie {close:.3f})",
                )
                print(f"[TRAILING] (dry-run) ticket {ticket} : SL aurait été déplacé à {label} ({new_sl:.3f})")
                _sl_applied[ticket] = target_pct
                continue

            res = m.order_send({
                "action": m.TRADE_ACTION_SLTP,
                "position": ticket,
                "symbol": pos.symbol,
                "sl": new_sl,
                "tp": tp,
            })

            if res is None or res.retcode != m.TRADE_RETCODE_DONE:
                error = str(m.last_error()) if res is None else res.comment
                print(f"[TRAILING] ticket {ticket} : échec déplacement SL à {new_sl:.3f} : {error}")
                continue  # retenté à la prochaine bougie, pas ce tour-ci

            _sl_applied[ticket] = target_pct
            notify(
                f"mymt5 — SL déplacé ({label})",
                f"{pos.symbol} {side} (ticket {ticket}) : nouveau SL {new_sl:.3f} (clôture bougie {close:.3f})",
            )
            print(f"[TRAILING] ticket {ticket} : SL déplacé à {label} ({new_sl:.3f})")

    # Nettoyage : une position fermée ne doit pas rester en mémoire. Seulement
    # si on a effectivement récupéré les positions ce tour-ci (pas d'appel
    # MT5 supplémentaire sinon).
    if positions_fetched is not None:
        current_tickets = {p.ticket for p in positions_fetched}
        for ticket in list(_sl_applied):
            if ticket not in current_tickets:
                del _sl_applied[ticket]
        forget_closed_timeframes(current_tickets)
