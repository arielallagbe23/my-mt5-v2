"""
scenarios.py — Point d'entrée unique pour évaluer une tâche.

Il n'y a plus de "choix" de scénario à la création d'une tâche : le système
vérifie automatiquement la condition commune, puis détermine LEQUEL des 4
sous-cas s'applique selon la position de l'open (de la bougie qui vient de
s'ouvrir) par rapport à la golden zone, et exécute celui-là.

`candle` attendu ici a DEUX origines différentes (voir tasks.py) :
  - close, low, high : bougie qui SE TERMINE à l'heure fixée de la tâche
  - open              : bougie qui COMMENCE à cette même heure (la suivante)

Vente : Fibo 2 dérivé du low de la bougie de clôture, condition close <= seuil.
Achat : Fibo 2 dérivé du high de la bougie de clôture, condition close >= seuil
        (miroir complet — mêmes niveaux Fibo numériques, sens inversé grâce à
        la convention de saisie du Fibo 1).
"""

from config import MAX_RISK_PERCENT
from scenario_shared import golden_zone
from sell_1 import evaluate_sell_1
from sell_2 import evaluate_sell_2
from sell_3 import evaluate_sell_3
from sell_4 import evaluate_sell_4
from buy_1 import evaluate_buy_1
from buy_2 import evaluate_buy_2
from buy_3 import evaluate_buy_3
from buy_4 import evaluate_buy_4


def evaluate_task(task, candle, account_size):
    """Vérifie d'abord le risque (garde-fou), puis délègue selon le sens
    (achat/vente) de la tâche."""
    # Filet de sécurité indépendant de l'API : même si une tâche avec un risque
    # aberrant arrivait jusqu'ici (bug, édition manuelle dans Firestore...), on
    # refuse de l'exécuter plutôt que de laisser passer un ordre disproportionné.
    risk = task.get("risk")
    if not isinstance(risk, (int, float)) or risk <= 0 or risk > MAX_RISK_PERCENT:
        return {"matched": False, "reason": f"Risque invalide ou hors limite (max {MAX_RISK_PERCENT}%) : {risk}"}

    scenario = task.get("scenario")
    if scenario == "sell":
        return evaluate_sell(task, candle, account_size)
    if scenario == "buy":
        return evaluate_buy(task, candle, account_size)

    return {"matched": False, "reason": f"Scénario non implémenté : {scenario}"}


def evaluate_sell(task, candle, account_size):
    """Condition commune aux 4 sous-cas, puis routage automatique vers
    Sell 1/2/3/4 selon la position de l'open par rapport à la golden zone."""
    threshold = task["priceCondition"]
    close = candle["close"]
    if close > threshold:
        return {
            "matched": False,
            "reason": f"Condition non remplie (close={close} > seuil {threshold})",
        }

    golden_low, golden_mid, golden_high, sl1, tp1 = golden_zone(task["fibo100"], task["fibo0"], candle["low"])
    open_price = candle["open"]

    if open_price >= golden_high:
        return evaluate_sell_1(task, candle, account_size)
    if open_price >= golden_mid:
        return evaluate_sell_2(task, candle, account_size, golden_high, sl1, tp1)
    if open_price >= golden_low:
        return evaluate_sell_3(task, candle, account_size, golden_mid, sl1, tp1)
    return evaluate_sell_4(task, candle, account_size, golden_low, sl1, tp1)


def evaluate_buy(task, candle, account_size):
    """Condition commune aux 4 sous-cas, puis routage automatique vers
    Buy 1/2/3/4 selon la position de l'open par rapport à la golden zone.
    Miroir complet de evaluate_sell (inégalités inversées, Fibo 2 dérivé du
    high de la bougie de clôture au lieu du low)."""
    threshold = task["priceCondition"]
    close = candle["close"]
    if close < threshold:
        return {
            "matched": False,
            "reason": f"Condition non remplie (close={close} < seuil {threshold})",
        }

    golden_low, golden_mid, golden_high, sl1, tp1 = golden_zone(task["fibo100"], task["fibo0"], candle["high"])
    open_price = candle["open"]

    if open_price <= golden_low:
        return evaluate_buy_1(task, candle, account_size)
    if open_price <= golden_mid:
        return evaluate_buy_2(task, candle, account_size, golden_low, sl1, tp1)
    if open_price <= golden_high:
        return evaluate_buy_3(task, candle, account_size, golden_mid, sl1, tp1)
    return evaluate_buy_4(task, candle, account_size, golden_high, sl1, tp1)
