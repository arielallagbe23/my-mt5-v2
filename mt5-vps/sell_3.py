"""
sell_3.py — Scénario Vente 3 (scenarioId "sell-3").
"""

from scenario_shared import finish_sell_order, golden_zone


def evaluate_sell_3(task, candle, account_size):
    """Condition d'entrée : l'open de la bougie de référence est dans la
    moitié BASSE de la golden zone (bornes incluses) :

      borne_basse_golden_zone <= open_bougie <= milieu_golden_zone

    Si vraie → Sell Limit au milieu du range, SL = SL1 (80% du Fibo 2),
    TP = TP1 (58,8% du Fibo 1).
    """
    golden_low, golden_mid, golden_high, sl1, tp1 = golden_zone(task["fibo100"], task["fibo0"], candle["low"])

    open_price = candle["open"]
    if not (golden_low <= open_price <= golden_mid):
        return {
            "matched": False,
            "reason": f"Condition non remplie (open={open_price}, golden zone [{golden_low:.3f} / {golden_mid:.3f} / {golden_high:.3f}])",
        }

    return finish_sell_order(golden_mid, sl1, tp1, candle["close"], task, account_size)
