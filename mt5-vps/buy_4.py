"""
buy_4.py — Sous-cas Achat 4 : l'open est au-dessus (ou à) la borne haute de
la golden zone. Le routeur (scenarios.py) a déjà calculé la golden zone et
vérifié cette position — cette fonction ne fait que construire l'ordre.
"""

from scenario_shared import fibo_price, finish_buy_order

MIN_RRP = 1.20  # ratio récompense/risque minimum ; en dessous, on vise TP2 au lieu de TP1


def evaluate_buy_4(task, candle, account_size, golden_high, sl1, tp1):
    """Entrée = borne haute de la golden zone, SL = SL1 (80% Fibo 2).

    TP : normalement TP1 (58,8% du Fibo 1). MAIS si le ratio récompense/risque
    avec TP1 est trop faible (RRP < 1,20 — reward/risk = distance(entrée, TP)
    / distance(entrée, SL)), on vise plus loin : TP2 (97,5% du Fibo 1) à la
    place, pour un ratio plus intéressant.
    """
    entry_price = golden_high

    rrp = abs(tp1 - entry_price) / abs(sl1 - entry_price)
    if rrp < MIN_RRP:
        tp2 = fibo_price(task["fibo100"], task["fibo0"], 0.975)  # niveau 97,5% du Fibo 1
        tp = tp2
    else:
        tp = tp1

    return finish_buy_order(entry_price, sl1, tp, candle["close"], task, account_size)
