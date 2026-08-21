import time

from google.cloud.firestore_v1.base_query import FieldFilter

from config import DRY_RUN, PRICE_SYMBOL
from mt5_client import ensure_mt5
from notify import notify

# ============================================================
# 1. ASSOCIATION À LA TÂCHE — le trailing stop est associé DE FACTO à une
#    tâche programmée : une position n'est gérée ici que si elle vient
#    d'une tâche mymt5 (commentaire MT5 "task-{id}"), jamais une position
#    ouverte manuellement.
# ============================================================

TASK_COMMENT_PREFIX = "task-"
ELIGIBLE_TIMEFRAMES = ("H1", "H4")


def _task_timeframe(db, comment):
    """Timeframe (H1/H4) de la tâche à l'origine de la position, ou None si
    la position ne vient pas d'une tâche (ou que la tâche a disparu)."""
    if not comment or not comment.startswith(TASK_COMMENT_PREFIX):
        return None
    task_id = comment[len(TASK_COMMENT_PREFIX):]
    doc = db.collection("tasks").document(task_id).get()
    if not doc.exists:
        return None
    return doc.to_dict().get("timeframe")


# ============================================================
# 2. OUVERTURE DE LA POSITION — dès qu'elle est ouverte, on a besoin de son
#    point d'entrée et de son TP pour tout ce qui suit.
# ============================================================


def _entry_and_tp(m, ticket):
    """Dès que la position est ouverte : son point d'entrée et son TP."""
    positions = m.positions_get(ticket=ticket) or ()
    if not positions:
        return None, None
    pos = positions[0]
    return pos.price_open, pos.tp


# ============================================================
# 3. PALIERS — prix aux niveaux 25/50/75/95% du chemin PE (0%) -> TP (100%),
#    calculés une fois à l'ouverture et stockés en base pour servir de
#    référence à chaque nouvelle bougie (survit à un redémarrage du VPS).
#    "applied" = palier le plus avancé déjà traité (-1 = aucun). "closed" =
#    la position a fini par disparaître (voir section 8).
# ============================================================

STAGE_PCTS = [25, 50, 75, 95]

# palier atteint -> palier où déplacer le SL (0 = BE). Rien pour 25% (juste
# un rapport, pas de mouvement).
SL_TARGET = {50: 0, 75: 25, 95: 50}


def _compute_levels(entry, tp):
    """Prix aux paliers 25/50/75/95% du chemin PE (0%) -> TP (100%),
    arrondis à 3 décimales comme les prix affichés sur le marché (USDJPY)."""
    return {pct: round(entry + (tp - entry) * (pct / 100), 3) for pct in STAGE_PCTS}


def _sl_price(entry, levels, sl_pct):
    """Prix réel correspondant à un palier de SL_TARGET : 0 -> entry (BE),
    25 -> levels[25], etc. — jamais un pourcentage abstrait, toujours un
    prix qu'order_send peut recevoir tel quel."""
    return entry if sl_pct == 0 else levels[sl_pct]


def _store_levels(db, ticket, entry, tp, levels):
    """Stocké en base (Firestore, pas juste en mémoire) pour survivre à un
    redémarrage du VPS et servir de référence à chaque nouvelle bougie."""
    db.collection("trailing_levels").document(str(ticket)).set({
        "entry": entry,
        "tp": tp,
        "levels": {str(pct): price for pct, price in levels.items()},
        "applied": -1,
        "closed": False,
    })


def _get_tracked(db, ticket):
    """Relit ce qui a été stocké par _store_levels — None si cette position
    n'a encore jamais été vue (premier passage)."""
    doc = db.collection("trailing_levels").document(str(ticket)).get()
    return doc.to_dict() if doc.exists else None


def _update_applied(db, ticket, target_pct):
    """Marque ce palier comme traité, pour ne jamais le retraiter ni
    reculer le SL à la bougie suivante."""
    db.collection("trailing_levels").document(str(ticket)).update({"applied": target_pct})


# ============================================================
# 4. BOUGIE — à chaque nouvelle bougie H1/H4 (selon le timeframe résolu en
#    section 1), on va chercher celle qui vient de CLÔTURER.
# ============================================================

_TF_CONSTANTS = {"H1": "TIMEFRAME_H1", "H4": "TIMEFRAME_H4"}


def _current_candle_time(m, timeframe):
    """Heure d'ouverture de la bougie EN COURS (pas encore clôturée) — sert
    uniquement à détecter qu'une nouvelle bougie vient de s'ouvrir."""
    tf_constant = getattr(m, _TF_CONSTANTS[timeframe])
    rates = m.copy_rates_from_pos(PRICE_SYMBOL, tf_constant, 0, 1)
    if rates is None or len(rates) == 0:
        return None
    return int(rates[0]["time"])


def _last_closed_candle(m, timeframe):
    """La dernière bougie H1/H4 CLÔTURÉE — jamais celle en cours de
    formation. Ex : position activée à 10h55, palier suivant à 11h ou 12h
    (selon heure hiver/été) -> on veut la bougie 07h-11h (ou -12h), pas
    celle qui vient tout juste de s'ouvrir.

    Position 1 (pas 0) demandée directement à MT5 = la bougie juste avant
    celle en cours — on ne calcule aucune heure nous-mêmes, donc aucun
    risque de décalage été/hiver ou broker."""
    tf_constant = getattr(m, _TF_CONSTANTS[timeframe])
    rates = m.copy_rates_from_pos(PRICE_SYMBOL, tf_constant, 1, 1)
    if rates is None or len(rates) == 0:
        return None
    return rates[0]


# ============================================================
# 5. PALIER ATTEINT — on compare le close de cette bougie aux niveaux de la
#    section 3, selon le sens de la position (buy/sell).
# ============================================================


def _highest_stage_reached(close, levels, is_buy):
    """Le palier le plus avancé atteint par ce close, selon le sens de la
    position : pour un achat, le prix doit être MONTÉ au moins jusqu'au
    niveau (close >= niveau) ; pour une vente, DESCENDU au moins jusque là
    (close <= niveau) — l'inverse de l'achat. STAGE_PCTS est croissant, donc
    le dernier palier qui valide la condition est le plus avancé."""
    reached = None
    for pct in STAGE_PCTS:
        price = levels[pct]
        if (is_buy and close >= price) or (not is_buy and close <= price):
            reached = pct
    return reached


# ============================================================
# 6. MESSAGE DU RAPPORT — zone (entre quels prix se situe le close) + action
#    (rien fait / SL déplacé / alerte 95%), assemblés en un seul message.
# ============================================================


def _describe_zone(close, entry, levels, is_buy):
    """Entre quels prix se situe le close, pour le message du rapport.
    "Dans le rouge" si le close est du mauvais côté de l'entrée (perte) —
    peu importe le sens, rien n'a jamais été fait dans ce cas."""
    if (is_buy and close < entry) or (not is_buy and close > entry):
        return "position dans le rouge"

    bounds = [(0, entry)] + [(pct, levels[pct]) for pct in STAGE_PCTS]
    for (_, lo), (_, hi) in zip(bounds, bounds[1:]):
        low, high = (lo, hi) if is_buy else (hi, lo)
        if low <= close <= high:
            return f"prix de close compris entre {low:.3f} et {high:.3f}"
    return f"prix de close au-delà de {bounds[-1][1]:.3f}"


def _stage_action(target_pct):
    """Ce qu'il faut faire pour CE palier, sous forme de texte d'action à
    coller après la description de zone. None = rien à faire (pas encore
    25%, déjà dans le rouge, ou palier déjà traité une bougie précédente —
    voir _process_position, qui ne passe target_pct que s'il est NOUVEAU)."""
    if target_pct is None or target_pct == 25:
        return "rien n'a été fait"
    if target_pct in SL_TARGET:
        sl_pct = SL_TARGET[target_pct]
        label = "BE" if sl_pct == 0 else f"{sl_pct}%"
        action = f"le SL est passé à {label}"
        if target_pct == 95:
            action += " — connecte-toi si tu veux couper à la main"
        return action
    return "rien n'a été fait"


def _build_message(close, entry, levels, is_buy, target_pct):
    """Assemble le message complet : zone + action. `target_pct` doit déjà
    être None si ce n'est pas un nouveau palier — voir _process_position."""
    zone = _describe_zone(close, entry, levels, is_buy)
    action = _stage_action(target_pct)
    return f"{zone}, {action}"


# ============================================================
# 7. HISTORIQUE — chaque message est horodaté et persisté sur la position,
#    consultable même si une notification push a été manquée.
# ============================================================


def _log_report(db, ticket, message, ts):
    """Historique chronologique de suivi pour CETTE position, horodaté à
    chaque nouvelle bougie — consultable même si une notification push a
    été manquée (voir le problème du rapport de 11h)."""
    db.collection("trailing_levels").document(str(ticket)).collection("history").add({
        "message": message,
        "ts": ts,
    })


# ============================================================
# 8. POSITION FERMÉE — détectée à CHAQUE tour de boucle (~10s, pas lié aux
#    bougies — sinon jusqu'à 4h avant qu'on remarque une clôture H4), sur
#    toutes les positions suivies encore marquées "closed": False.
# ============================================================


def _close_reason_message(m, ticket):
    """TP hit / SL hit + résultat net en $, quand la position a disparu —
    déterminé via le DEAL_REASON du deal de clôture (réutilise
    _deals_to_trade de trades.py, la même logique fiable que le reste du
    projet), jamais une estimation par le prix (peu fiable avec le
    slippage/spread). Message unique pour cette position — voir
    alerte_me_by_level.py, qui saute les positions suivies ici pour ne pas
    notifier deux fois la même clôture."""
    from trades import _deals_to_trade

    deals = m.history_deals_get(position=ticket) or ()
    trade = _deals_to_trade(m, ticket, deals)
    if trade is None:
        return None
    reason = trade["reason"]
    net = trade["net"]
    sign = "+" if net >= 0 else ""
    label = "TP hit" if reason == "TP" else "SL hit" if reason == "SL" else f"position fermée ({reason})"
    return f"{label} — {sign}{net:.2f}$"


def _check_closed(db, m):
    """Diff entre les positions suivies (trailing_levels, closed=False) et
    les positions MT5 actuellement ouvertes — log le message final et
    marque "closed" (jamais supprimé, pour garder l'historique lisible)."""
    open_tickets = {p.ticket for p in (m.positions_get(symbol=PRICE_SYMBOL) or ())}
    for doc in db.collection("trailing_levels").where(filter=FieldFilter("closed", "==", False)).stream():
        ticket = int(doc.id)
        if ticket in open_tickets:
            continue
        message = _close_reason_message(m, ticket)
        if message:
            _log_report(db, ticket, message, int(time.time()))
            notify(f"mymt5 — position {ticket} fermée", message)
        doc.reference.update({"closed": True})


# ============================================================
# 9. DÉPLACEMENT RÉEL DU SL — respecte DRY_RUN comme le reste du VPS.
# ============================================================


def _move_sl(m, ticket, symbol, tp, sl_price):
    if DRY_RUN:
        print(f"[TRAILING] (dry-run) ticket {ticket} : SL aurait été déplacé à {sl_price:.3f}")
        return

    res = m.order_send({
        "action": m.TRADE_ACTION_SLTP,
        "position": ticket,
        "symbol": symbol,
        "sl": sl_price,
        "tp": tp,
    })
    if res is None or res.retcode != m.TRADE_RETCODE_DONE:
        error = str(m.last_error()) if res is None else res.comment
        print(f"[TRAILING] ticket {ticket} : échec déplacement SL à {sl_price:.3f} : {error}")
        return

    print(f"[TRAILING] ticket {ticket} : SL déplacé à {sl_price:.3f}")


# ============================================================
# 10. ORCHESTRATION — point d'entrée appelé depuis mt5_status.py.
# ============================================================

_last_processed_candle_time = {}


def _process_position(db, m, pos, close):
    """Une position suivie, à la clôture d'UNE bougie de son timeframe :
    calcule/relit ses niveaux, détermine le palier atteint, rapporte, et
    déplace le SL si c'est un nouveau palier."""
    ticket = pos.ticket
    tracked = _get_tracked(db, ticket)

    if tracked is None:
        entry, tp = pos.price_open, pos.tp
        if not tp:
            return  # pas de TP défini, rien à trailer ni à rapporter
        levels = _compute_levels(entry, tp)
        _store_levels(db, ticket, entry, tp, levels)
        applied = -1
    else:
        entry = tracked["entry"]
        tp = tracked["tp"]
        levels = {int(pct): price for pct, price in tracked["levels"].items()}
        applied = tracked.get("applied", -1)

    is_buy = pos.type == 0  # POSITION_TYPE_BUY
    target_pct = _highest_stage_reached(close, levels, is_buy)
    is_new_stage = target_pct is not None and target_pct > applied

    message = _build_message(close, entry, levels, is_buy, target_pct if is_new_stage else None)
    _log_report(db, ticket, message, int(time.time()))
    notify(f"mymt5 — suivi position {ticket}", message)
    print(f"[TRAILING] ticket {ticket} : {message}")

    if not is_new_stage:
        return

    _update_applied(db, ticket, target_pct)
    if target_pct in SL_TARGET:
        sl_price = _sl_price(entry, levels, SL_TARGET[target_pct])
        _move_sl(m, ticket, pos.symbol, tp, sl_price)


def check_trailing_stop(db):
    """Point d'entrée appelé depuis la boucle de mt5_status.py. Détecte les
    positions fermées à chaque tour (~10s), et — une fois par nouvelle
    bougie H1/H4 — rapporte + trail chaque position suivie de ce
    timeframe."""
    m = ensure_mt5()
    if m is None:
        return

    _check_closed(db, m)

    for timeframe in ELIGIBLE_TIMEFRAMES:
        # Aucune horloge consultée ici, ni système ni broker : on compare
        # juste l'heure d'ouverture de la bougie courante à la dernière
        # valeur vue. Dès qu'elle change, une nouvelle bougie vient de
        # s'ouvrir — donc position 1 (_last_closed_candle) est déjà
        # complète par construction, pas de délai de sécurité à calculer.
        # Immunisé par nature contre tout décalage de fuseau/broker (voir
        # le bug corrigé juste avant ce commentaire).
        current_time = _current_candle_time(m, timeframe)
        if current_time is None:
            continue
        if _last_processed_candle_time.get(timeframe) == current_time:
            continue  # déjà traité pour cette bougie

        _last_processed_candle_time[timeframe] = current_time

        candle = _last_closed_candle(m, timeframe)
        if candle is None:
            continue
        close = float(candle["close"])

        for pos in m.positions_get(symbol=PRICE_SYMBOL) or ():
            if _task_timeframe(db, pos.comment) != timeframe:
                continue
            _process_position(db, m, pos, close)
