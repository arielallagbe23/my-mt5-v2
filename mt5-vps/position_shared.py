"""
position_shared.py — Primitives partagées par les modules de surveillance
des positions (order_fills.py, untracked_positions.py, tp_progress.py,
trailing_stop.py, hourly_update.py) : résolution du timeframe éligible
d'une position, lecture des bougies H1/H4, et calculs de progression
entrée -> TP. Ce module n'agit jamais tout seul — il n'est appelé depuis
mt5_status.py que via les modules qui, eux, l'utilisent.
"""

POSITION_TYPE_NAMES = {0: "Buy", 1: "Sell"}
ELIGIBLE_TIMEFRAMES = {"H1", "H4"}  # le M15 est exclu — trop de bruit
_TF_CONSTANTS = {"H1": "TIMEFRAME_H1", "H4": "TIMEFRAME_H4"}

# ticket -> timeframe éligible ("H1"/"H4"), via la tâche d'origine ou une
# activation manuelle. N'est rempli QUE quand un timeframe éligible a été
# trouvé (voir resolve_timeframe) — jamais mis en cache à None/non-éligible,
# pour qu'une activation manuelle faite après coup soit prise en compte.
# Partagé par tous les modules qui appellent resolve_timeframe.
_position_timeframe_cache = {}


def _task_timeframe(db, comment):
    """Retrouve le timeframe de la tâche à l'origine d'une position via son
    commentaire MT5 (format "task-{taskId}", posé par tasks.py à la création
    de l'ordre). Retourne None si le commentaire est absent/inattendu ou si
    la tâche n'existe plus."""
    if not comment or not comment.startswith("task-"):
        return None
    task_id = comment[len("task-") :]
    doc = db.collection("tasks").document(task_id).get()
    if not doc.exists:
        return None
    return doc.to_dict().get("timeframe")


def _manual_timeframe(db, ticket):
    """Timeframe activé manuellement depuis l'app pour une position qui n'a
    PAS été ouverte par une tâche mymt5 (managed_positions/{ticket}, écrit
    par le bouton "Activer le suivi" côté app)."""
    doc = db.collection("managed_positions").document(str(ticket)).get()
    if not doc.exists:
        return None
    return doc.to_dict().get("timeframe")


def resolve_timeframe(db, ticket, comment):
    """Timeframe éligible (H1/H4) d'une position, via sa tâche d'origine en
    priorité, sinon via une activation manuelle. Mis en cache UNIQUEMENT
    quand un timeframe éligible est trouvé : une position sans timeframe
    éligible reste non mise en cache, pour qu'une activation manuelle faite
    après coup soit prise en compte au prochain contrôle."""
    if ticket in _position_timeframe_cache:
        return _position_timeframe_cache[ticket]
    timeframe = _task_timeframe(db, comment) or _manual_timeframe(db, ticket)
    if timeframe in ELIGIBLE_TIMEFRAMES:
        _position_timeframe_cache[ticket] = timeframe
    return timeframe


def forget_closed_timeframes(current_tickets):
    """Purge le cache de timeframes pour tout ticket qui n'est plus ouvert —
    à appeler en fin de cycle par chaque module qui utilise resolve_timeframe,
    avec son propre instantané des positions actuellement ouvertes."""
    for ticket in list(_position_timeframe_cache):
        if ticket not in current_tickets:
            del _position_timeframe_cache[ticket]


def candles_current_and_previous(m, symbol, timeframe):
    """Renvoie (bougie précédente, bougie courante) pour ce timeframe, ou
    (None, None) si indisponible. Position 0 = courante (en formation),
    position 1 = celle qui vient de se terminer."""
    tf_constant = getattr(m, _TF_CONSTANTS[timeframe])
    rates = m.copy_rates_from_pos(symbol, tf_constant, 0, 2)
    if rates is None or len(rates) < 2:
        return None, None
    return rates[0], rates[-1]  # ordre chronologique : [précédente, courante]


def candle_peak(pos, previous_bar):
    """Pic atteint par la bougie précédente dans le sens favorable à la
    position : high pour un achat, low pour une vente."""
    is_buy = pos.type == 0  # POSITION_TYPE_BUY
    return float(previous_bar["high"]) if is_buy else float(previous_bar["low"])


def signed_progress(pos, price):
    """Progression signée entrée -> TP à un prix donné : positive vers le
    TP, négative vers la perte. Contrairement à un calcul en abs(), un prix
    en perte ne peut jamais ressortir comme une progression positive — un
    aller-retour à +75% puis clôture à -10% dans la même bougie ne doit pas
    être lu comme "75% de progression"."""
    entry = pos.price_open
    tp = pos.tp
    total_distance = abs(tp - entry)
    if not total_distance:
        return None
    direction = 1 if pos.type == 0 else -1  # POSITION_TYPE_BUY == 0
    return direction * (price - entry) / total_distance * 100
