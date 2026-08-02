"""
buy_3.py — Sous-cas Achat 3 : l'open est dans la moitié HAUTE de la golden
zone. Le routeur (scenarios.py) a déjà calculé la golden zone et vérifié
cette position — cette fonction ne fait que construire l'ordre.
"""

from scenario_shared import finish_buy_order


def evaluate_buy_3(task, candle, account_size, golden_mid, sl1, tp1):
    """Entrée = milieu de la golden zone, SL = SL1 (80% Fibo 2), TP = TP1
    (58,8% Fibo 1)."""
    return finish_buy_order(golden_mid, sl1, tp1, candle["close"], task, account_size)
