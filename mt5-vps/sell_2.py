"""
sell_2.py — Sous-cas Vente 2 : l'open est dans la moitié HAUTE de la golden
zone. Le routeur (scenarios.py) a déjà calculé la golden zone et vérifié
cette position — cette fonction ne fait que construire l'ordre.
"""

from scenario_shared import finish_sell_order


def evaluate_sell_2(task, candle, account_size, golden_high, sl1, tp1):
    """Entrée = borne haute de la golden zone, SL = SL1 (80% Fibo 2), TP = TP1
    (58,8% Fibo 1)."""
    return finish_sell_order(golden_high, sl1, tp1, candle["close"], task, account_size)
