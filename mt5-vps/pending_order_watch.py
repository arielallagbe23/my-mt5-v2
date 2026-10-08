"""
pending_order_watch.py — Surveille les ordres différés (Buy/Sell Limit) pas
encore déclenchés : si le marché a déjà parcouru au moins BE_STAGE_PCT
(50%) du chemin entre le point d'entrée (PE) et le TP SANS que l'ordre ne
se soit déclenché (ex: un pullback raté de 2-3 pips, puis le prix repart
directement vers le TP), l'ordre est annulé automatiquement.

Pourquoi 50% précisément : si l'ordre avait été déclenché et suivi par le
trailing stop (voir trailing_stop.py, SL_TARGET), le SL serait déjà passé
au point d'entrée (break-even) à ce palier. Comme l'ordre n'a jamais été
déclenché, il n'y a ni position ni SL à déplacer — mais le garder actif
n'a plus de sens : le remplir maintenant reviendrait à ouvrir avec un
ratio risque/récompense bien pire que prévu au départ (le mouvement a
déjà eu lieu sans nous).

Vérifié à chaque clôture de bougie H1/H4 (même mécanisme que
trailing_stop.py), jamais à chaque tick — un dépassement furtif
intra-bougie ne compte pas, seule une clôture au-delà du seuil déclenche
l'annulation. Le timeframe utilisé est celui de la tâche d'origine
(comment "task-{id}") si l'ordre en vient, sinon DEFAULT_TIMEFRAME (les
ordres manuels/programmés n'ont pas de timeframe associé).
"""

from config import DRY_RUN, PRICE_SYMBOL
from mt5_client import ensure_mt5
from notify import notify

BE_STAGE_PCT = 0.5  # palier "break-even" — voir l'explication ci-dessus
DEFAULT_TIMEFRAME = "H4"  # même défaut que l'activation auto du trailing stop (order_fills.py)
ELIGIBLE_TIMEFRAMES = ("H1", "H4")
_TF_CONSTANTS = {"H1": "TIMEFRAME_H1", "H4": "TIMEFRAME_H4"}

# ticket -> heure d'ouverture de la dernière bougie déjà traitée, par
# timeframe — même principe que trailing_stop.py, scope propre à ce module.
_last_processed_candle_time = {}


def _current_candle_time(m, timeframe):
    """Heure d'ouverture de la bougie EN COURS (pas encore clôturée) — sert
    uniquement à détecter qu'une nouvelle bougie vient de s'ouvrir."""
    tf_constant = getattr(m, _TF_CONSTANTS[timeframe])
    rates = m.copy_rates_from_pos(PRICE_SYMBOL, tf_constant, 0, 1)
    if rates is None or len(rates) == 0:
        return None
    return int(rates[0]["time"])


def _last_closed_candle(m, timeframe):
    """La dernière bougie H1/H4 CLÔTURÉE — jamais celle en cours."""
    tf_constant = getattr(m, _TF_CONSTANTS[timeframe])
    rates = m.copy_rates_from_pos(PRICE_SYMBOL, tf_constant, 1, 1)
    if rates is None or len(rates) == 0:
        return None
    return rates[0]


def _order_timeframe(db, comment):
    """Timeframe de la tâche à l'origine de l'ordre (comment "task-{id}"),
    sinon DEFAULT_TIMEFRAME — un ordre manuel/programmé n'a pas de
    timeframe propre, voir le docstring du module."""
    if comment and comment.startswith("task-"):
        task_id = comment[len("task-"):]
        doc = db.collection("tasks").document(task_id).get()
        if doc.exists:
            tf = doc.to_dict().get("timeframe")
            if tf in ELIGIBLE_TIMEFRAMES:
                return tf
    return DEFAULT_TIMEFRAME


def _progress_pct(order, close):
    """Fraction du chemin PE -> TP déjà parcourue par ce close, selon le
    sens de l'ordre (Buy Limit ou Sell Limit — les deux seuls types posés
    par ce système). >= 1 veut dire le close a atteint/dépassé le TP.
    None si le TP n'est pas défini (rien à mesurer)."""
    entry = order.price_open
    tp = order.tp
    if not tp:
        return None
    is_buy = order.type == 2  # ORDER_TYPE_BUY_LIMIT — évite une dépendance au module m ici
    total = (tp - entry) if is_buy else (entry - tp)
    if not total:
        return None
    moved = (close - entry) if is_buy else (entry - close)
    return moved / total


def _cancel_order(m, order, progress):
    if DRY_RUN:
        print(f"[MISSED_ENTRY] (dry-run) annulerait ticket {order.ticket} (progress={progress:.0%})")
        return

    res = m.order_send({"action": m.TRADE_ACTION_REMOVE, "order": order.ticket})
    if res is None or res.retcode != m.TRADE_RETCODE_DONE:
        error = str(m.last_error()) if res is None else res.comment
        print(f"[MISSED_ENTRY] échec annulation ticket {order.ticket} : {error}")
        return

    notify(
        "mymt5 — ordre différé annulé (entrée ratée)",
        f"{order.symbol} ticket {order.ticket} : le marché a dépassé {BE_STAGE_PCT:.0%} du "
        "chemin PE→TP sans que l'ordre ne se déclenche, annulé automatiquement.",
    )
    print(f"[MISSED_ENTRY] ticket {order.ticket} annulé (progress={progress:.0%})")


def check_missed_entry_orders(db):
    m = ensure_mt5()
    if m is None:
        return

    orders = m.orders_get(symbol=PRICE_SYMBOL) or ()
    if not orders:
        return

    for timeframe in ELIGIBLE_TIMEFRAMES:
        # Même détection "nouvelle bougie" que trailing_stop.py : aucune
        # horloge consultée, on compare juste l'heure d'ouverture de la
        # bougie courante à la dernière valeur vue.
        current_time = _current_candle_time(m, timeframe)
        if current_time is None:
            continue
        if _last_processed_candle_time.get(timeframe) == current_time:
            continue
        _last_processed_candle_time[timeframe] = current_time

        candle = _last_closed_candle(m, timeframe)
        if candle is None:
            continue
        close = float(candle["close"])

        for order in orders:
            if _order_timeframe(db, order.comment) != timeframe:
                continue
            progress = _progress_pct(order, close)
            if progress is None or progress < BE_STAGE_PCT:
                continue
            _cancel_order(m, order, progress)
