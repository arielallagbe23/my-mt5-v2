#!/usr/bin/env python3
"""
Question 9 — Bilan quotidien de la situation

Lit tous les daily_questions/01-08 déjà collectés (7h00-7h35) et les fait
synthétiser en une explication simple par Claude. Aucune recherche web — les
données sont déjà là, Claude ne fait que les mettre en récit — donc peu
coûteux (pas de tool web_search, un seul appel par jour).
"""

import json
from datetime import datetime, timezone

from anthropic import Anthropic
from google.cloud import firestore

from config import ANTHROPIC_API_KEY, SA_PATH

db = firestore.Client.from_service_account_json(SA_PATH)

MODEL = "claude-sonnet-5"

QUESTION_IDS = [
    "01_taux_fed_boj",
    "02_calendrier_eco",
    "03_risque_intervention",
    "04_sentiment_risk_on_off",
    "05_structure_d1",
    "06_confirmation_h4",
    "07_setup_h1",
    "08_correlation_10y",
]

SYSTEM_PROMPT = """Tu es un analyste macro qui résume la situation du marché USDJPY pour un
trader qui lit ce résumé chaque matin avant de commencer sa journée.

Tu reçois un JSON contenant plusieurs indicateurs déjà calculés : taux Fed/BoJ et actus
récentes, calendrier économique de la semaine, risque d'intervention BoJ/MoF, sentiment
risk-on/risk-off global, structure technique D1, confirmation H4/D1, setup d'entrée H1,
exposition et corrélation avec le rendement 10 ans US.

Produis une synthèse claire et explicative : qu'est-ce qui se passe, pourquoi c'est
important, comment les différents signaux s'articulent entre eux. Reste factuel — jamais
de conseil d'action (achat/vente/taille de position), uniquement des faits et leur
contexte. Écris en français, dans un style direct et lisible, comme un résumé qu'on lit
en 30 secondes le matin."""


def _serialize(value):
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def get_daily_questions_json():
    result = {}
    for doc_id in QUESTION_IDS:
        doc = db.collection("daily_questions").document(doc_id).get()
        if doc.exists:
            result[doc_id] = {k: _serialize(v) for k, v in doc.to_dict().items()}
    return result


if __name__ == "__main__":
    if not ANTHROPIC_API_KEY:
        raise SystemExit("[ERREUR] anthropic_key.txt introuvable (ou ANTHROPIC_API_KEY absent).")

    donnees = get_daily_questions_json()
    if not donnees:
        raise SystemExit("[ERREUR] Aucune donnée daily_questions trouvée — lance les scripts 01-08 d'abord.")

    client = Anthropic(api_key=ANTHROPIC_API_KEY)
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Voici les données du jour :\n\n{json.dumps(donnees, ensure_ascii=False, indent=2)}",
            }
        ],
    )

    if response.stop_reason == "refusal":
        raise RuntimeError(f"Refus du modèle : {response.stop_details}")

    text_blocks = [b.text for b in response.content if b.type == "text"]
    if not text_blocks:
        raise RuntimeError("Aucun bloc texte dans la réponse Claude")

    data = {
        "synthese": text_blocks[-1],
        "updated_at": datetime.now(timezone.utc),
    }

    db.collection("daily_questions").document("09_bilan_quotidien").set(data)
    print("Écrit dans Firestore avec succès :")
    print(data)
