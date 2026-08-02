"""
sell_1.py — Scénario Vente 1 (scenarioId "sell-1").
"""

from scenario_shared import compute_lot_size, fibo_price


def evaluate_sell_1(task, candle, account_size):
    """Condition d'entrée (les DEUX doivent être vraies) :
      1. close de la bougie de référence <= "condition de prix" choisie par l'utilisateur
      2. open de cette même bougie >= borne haute de la "golden zone" (golden zone =
         entre les niveaux 23,6% du Fibo 1 saisi à la main et du Fibo 2 dérivé
         automatiquement du low de la bougie de référence)

    Si les deux sont vraies → on place un Sell Limit :
      - Entrée = "prix support intéressant" (saisi à la main dans la tâche)
      - SL     = niveau -0,05% du Fibo 1
      - TP     = niveau 58,8% du Fibo 1

    Pourquoi le CLOSE de la bougie et pas un prix live ? Comparer contre un prix
    "live" au moment de la décision serait risqué (le marché peut bouger pendant
    le calcul). Le close est une valeur figée, déjà connue, aucun risque de timing.
    """
    fibo100 = task["fibo100"]  # borne haute du Fibo 1 (100%), saisie par l'utilisateur
    fibo0 = task["fibo0"]  # borne basse du Fibo 1 (0%), saisie par l'utilisateur

    fibo1_236 = fibo_price(fibo100, fibo0, 0.236)  # niveau 23,6% du Fibo 1
    sl = fibo_price(fibo100, fibo0, -0.05)  # niveau -0,05% du Fibo 1 -> stop loss
    tp = fibo_price(fibo100, fibo0, 0.588)  # niveau 58,8% du Fibo 1 -> take profit

    # Fibo 2 : 100% = fibo0 (le 0% du Fibo 1), 0% = low de la bougie de référence
    # (dérivé automatiquement, contrairement au Fibo 1 saisi à la main).
    fibo2_236 = fibo_price(fibo0, candle["low"], 0.236)

    # Golden zone = zone entre les niveaux 23,6% des deux Fibo. On ne sait pas à
    # l'avance lequel des deux est le plus haut, donc on prend le max comme borne
    # haute de la condition d'entrée.
    golden_high = max(fibo1_236, fibo2_236)

    threshold = task["priceCondition"]  # seuil de comparaison sur le close, saisi par l'utilisateur
    entry_price = task["supportPrice"]  # prix d'entrée du Sell Limit, saisi par l'utilisateur

    # --- Les deux conditions du scénario ---
    close_below = candle["close"] <= threshold
    open_above = candle["open"] >= golden_high
    if not (close_below and open_above):
        return {
            "matched": False,
            "reason": f"Condition non remplie (close={candle['close']}, open={candle['open']})",
        }

    # --- Garde-fou de sécurité : un Sell Limit n'a de sens que si SL > Entrée > TP.
    # Si les niveaux Fibo sont mal configurés (ex: inversés), on bloque plutôt que
    # d'envoyer un ordre incohérent qui exposerait à un risque mal calculé. ---
    if not (sl > entry_price > tp):
        return {
            "matched": False,
            "reason": f"Ordre incohérent (SL {sl} / Entrée {entry_price} / TP {tp})",
        }

    # Montant risqué en devise du compte, dérivé du % de risque choisi sur la tâche
    # et du capital de référence fixe (voir mémoire risk-sizing-strategy — ce n'est
    # PAS l'équité live, c'est intentionnel).
    risk_amount = (task["risk"] / 100) * account_size if account_size else None
    lot = compute_lot_size(risk_amount, entry_price, sl, candle["close"])

    return {
        "matched": True,
        "orderType": "Sell Limit",
        "entry": entry_price,
        "sl": sl,
        "tp": tp,
        "lot": lot,
    }
