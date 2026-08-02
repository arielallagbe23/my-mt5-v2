"""
sell_4.py — Scénario Vente 4 (scenarioId "sell-4").
"""

from scenario_shared import fibo_price, finish_sell_order, golden_zone

MIN_RRP = 1.20  # ratio récompense/risque minimum ; en dessous, on vise TP2 au lieu de TP1


def evaluate_sell_4(task, candle, account_size):
    """Condition d'entrée : l'open de la bougie de référence est sous (ou à)
    la borne basse de la golden zone :

      open_bougie <= borne_basse_golden_zone

    Si vraie → Sell Limit à la borne basse du range, SL = SL1 (80% du Fibo 2).

    TP : normalement TP1 (58,8% du Fibo 1), comme Sell 2/3. MAIS si le ratio
    récompense/risque avec TP1 est trop faible (RRP < 1,20 — reward/risk =
    distance(entrée, TP) / distance(entrée, SL)), on vise plus loin : TP2
    (97,5% du Fibo 1) à la place, pour un ratio plus intéressant.
    """
    golden_low, golden_mid, golden_high, sl1, tp1 = golden_zone(task["fibo100"], task["fibo0"], candle["low"])

    open_price = candle["open"]
    if not (open_price <= golden_low):
        return {
            "matched": False,
            "reason": f"Condition non remplie (open={open_price}, borne basse={golden_low:.3f})",
        }

    entry_price = golden_low

    # RRP calculé avec TP1 en référence, pour décider si on garde TP1 ou si
    # on vise TP2 (plus loin, meilleur ratio).
    rrp = abs(tp1 - entry_price) / abs(sl1 - entry_price)
    if rrp < MIN_RRP:
        tp2 = fibo_price(task["fibo100"], task["fibo0"], 0.975)  # niveau 97,5% du Fibo 1
        tp = tp2
    else:
        tp = tp1

    return finish_sell_order(entry_price, sl1, tp, candle["close"], task, account_size)
