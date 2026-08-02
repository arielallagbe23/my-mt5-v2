"""
scenarios.py — Logique de trading pure : taille de position et conditions
d'entrée. Aucune fonction ici ne touche à MT5 ou Firestore — tout est calculé
à partir des données qu'on lui donne, ce qui les rend faciles à tester
isolément (voir les tests manuels en bas de ce fichier en commentaire, ou
lancer `python -c "import scenarios; ..."`).
"""

from config import CONTRACT_SIZE, FEE_BUFFER, MAX_RISK_PERCENT


def compute_lot_size(risk_amount, entry_price, sl_price, current_price):
    """Calcule la taille de position (en lots) pour risquer exactement `risk_amount`
    (dans la devise du compte) si le prix va de `entry_price` jusqu'à `sl_price`.

    Port direct de l'ancien src/lib/scenarios/shared.js computeLotSize (supprimé —
    ce fichier est maintenant la seule implémentation vivante, à garder cohérente
    si la formule change un jour).

    Formule, en 3 étapes :
      1. `distance` = écart de prix entre l'entrée et le SL (toujours positif, peu
         importe le sens achat/vente).
      2. `risk_per_lot` = perte en devise du compte SI on tradait 1 lot entier et que
         le prix touchait le SL. Pour une paire cotée en JPY (comme USDJPY) avec un
         compte en USD :
           perte_JPY = distance × CONTRACT_SIZE
           perte_USD = perte_JPY ÷ current_price   (conversion JPY → USD au cours actuel)
         D'où : risk_per_lot = (distance × CONTRACT_SIZE) / current_price
      3. `lots` = combien de lots pour que la perte totale (si le SL est touché) égale
         exactement `risk_amount` : lots = risk_amount / risk_per_lot
         On réduit ensuite de 5% (FEE_BUFFER) pour ne pas dépasser le risque prévu une
         fois les commissions et le spread pris en compte.

    Le résultat est arrondi au centième de lot, avec un plancher de 0,01 (taille
    minimale tradable) — même si ça peut faire dépasser légèrement le risque visé sur
    de très petits comptes, c'est un choix assumé (voir mémoire risk-sizing-strategy).

    Retourne None si une donnée manque (risk_amount/distance/current_price nul ou 0).
    """
    distance = abs(entry_price - sl_price)
    if not risk_amount or not distance or not current_price:
        return None

    risk_per_lot = (distance * CONTRACT_SIZE) / current_price
    if not risk_per_lot:
        return None

    lots = (risk_amount / risk_per_lot) * (1 - FEE_BUFFER)
    return max(0.01, round(lots, 2))


def fibo_price(hi, lo, level):
    """Prix correspondant à un niveau de retracement Fibonacci entre `lo` (0%) et
    `hi` (100%). Ex: level=0.236 -> prix à 23,6% en remontant de lo vers hi. Les
    niveaux hors [0, 1] (ex: -0.05, 1.0 utilisés ailleurs) sont valides aussi,
    c'est juste une interpolation (ou extrapolation) linéaire."""
    return lo + (hi - lo) * level


def evaluate_sell_1(task, candle, account_size):
    """Scénario Vente 1 — seul scénario existant pour l'instant (scenarioId "sell-1").

    Condition d'entrée (les DEUX doivent être vraies) :
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


# Un seul scénario existe pour l'instant. Quand d'autres seront ajoutés (achat,
# autres scénarios de vente...), ils viendront s'ajouter ici avec leur propre
# scenarioId — c'est ce qui permet à evaluate_task de router vers la bonne fonction.
SCENARIO_EVALUATORS = {
    "sell-1": evaluate_sell_1,
}


def evaluate_task(task, candle, account_size):
    """Point d'entrée unique pour évaluer une tâche : vérifie d'abord le risque
    (garde-fou), puis délègue au bon scénario."""
    # Filet de sécurité indépendant de l'API : même si une tâche avec un risque
    # aberrant arrivait jusqu'ici (bug, édition manuelle dans Firestore...), on
    # refuse de l'exécuter plutôt que de laisser passer un ordre disproportionné.
    risk = task.get("risk")
    if not isinstance(risk, (int, float)) or risk <= 0 or risk > MAX_RISK_PERCENT:
        return {"matched": False, "reason": f"Risque invalide ou hors limite (max {MAX_RISK_PERCENT}%) : {risk}"}

    evaluator = SCENARIO_EVALUATORS.get(task.get("scenarioId"))
    if evaluator is None:
        return {"matched": False, "reason": f"Scénario inconnu : {task.get('scenarioId')}"}
    return evaluator(task, candle, account_size)
