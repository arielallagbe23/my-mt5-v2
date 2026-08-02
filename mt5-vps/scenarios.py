"""
scenarios.py — Registre des scénarios : associe chaque scenarioId à sa
fonction d'évaluation, et sert de point d'entrée unique (evaluate_task) pour
tasks.py. Un fichier par scénario (sell_1.py, et les suivants à venir) ; la
logique partagée (taille de position, Fibonacci) vit dans scenario_shared.py.

Pour ajouter un scénario : créer son fichier (ex: buy_1.py), l'importer ici,
et l'ajouter à SCENARIO_EVALUATORS avec son scenarioId.
"""

from config import MAX_RISK_PERCENT
from sell_1 import evaluate_sell_1
from sell_2 import evaluate_sell_2

SCENARIO_EVALUATORS = {
    "sell-1": evaluate_sell_1,
    "sell-2": evaluate_sell_2,
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
