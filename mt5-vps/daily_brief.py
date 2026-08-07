"""
daily_brief.py — Génère un point macro USDJPY via l'API Claude (recherche web
en direct) et l'écrit dans Firestore. Appelé à heures fixes par le planificateur
de tâches du VPS (pas par la boucle continue de mt5_status.py — rythme différent :
quelques créneaux par jour, pas du polling en continu).

Usage :
  python daily_brief.py <checkpoint>
  ex : python daily_brief.py morning

Pré-requis (en plus de ceux de mt5_status.py) :
  anthropic_key.txt — clé API Anthropic, jamais commitée (même régime que
                       cron_secret.txt). Variable d'env ANTHROPIC_API_KEY
                       acceptée en alternative.
"""

import json
import os
import sys
from datetime import datetime, timezone

from anthropic import Anthropic

from config import ANTHROPIC_API_KEY, SA_PATH
from notify import notify

MODEL = "claude-sonnet-5"

BRIEF_SCHEMA = {
    "type": "object",
    "properties": {
        "date": {"type": "string"},
        "checkpoint": {
            "type": "string",
            "enum": ["morning", "london_open", "us_data", "ny_open", "fomc", "boj_watch"],
        },
        "overnightMove": {
            "anyOf": [
                {
                    "type": "object",
                    "properties": {
                        "fromPrice": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                        "toPrice": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                        "pct": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                    },
                    "required": ["fromPrice", "toPrice", "pct"],
                    "additionalProperties": False,
                },
                {"type": "null"},
            ]
        },
        "events": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "time": {"type": "string"},
                    "title": {"type": "string"},
                    "impact": {"type": "string", "enum": ["high", "medium"]},
                    "currency": {"type": "string", "enum": ["USD", "JPY"]},
                },
                "required": ["time", "title", "impact", "currency"],
                "additionalProperties": False,
            },
        },
        "interventionRisk": {"type": "boolean"},
        "note": {
            "type": "string",
            "description": "Résumé factuel en 2-3 phrases maximum, sans jargon inutile, sans conseil.",
        },
    },
    "required": ["date", "checkpoint", "overnightMove", "events", "interventionRisk", "note"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """Tu es un assistant de veille macro pour un trader USDJPY. Ton rôle : produire un
point de situation factuel et concis, jamais un conseil de trading, jamais de recommandation
d'achat/vente.

À chaque appel, utilise l'outil web_search pour vérifier l'information la plus récente sur :
1. Le prix USDJPY actuel et son mouvement depuis la clôture NY précédente
2. Le calendrier économique du jour (USD et JPY uniquement, impact moyen/élevé)
3. Toute déclaration récente de la BoJ, du Fed, ou du ministère des Finances japonais concernant
   une intervention sur le yen
4. Le rendement du JGB 30 ans si pertinent au contexte du jour

Contraintes :
- Si aucune donnée fiable n'est trouvée pour un champ, mets une valeur vide/null plutôt que
  d'inventer.
- Le champ "note" ne doit jamais contenir de recommandation d'action (achat/vente/taille de
  position) — uniquement des faits et leur contexte.
- Reste factuel : pas de ton alarmiste, pas de superlatifs."""


def today_key():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# fomc/boj_watch ne se déclenchent que les jours où le morning brief a repéré
# l'événement dans son calendrier — sinon on paie l'appel API pour rien.
CONDITIONAL_TRIGGERS = {
    "fomc": ["fomc", "federal reserve", "fed rate"],
    "boj_watch": ["boj", "bank of japan"],
}


def morning_detected_event(db, keywords):
    doc = db.collection("dailyBrief").document(today_key()).collection("checkpoints").document("morning").get()
    if not doc.exists:
        return False
    events = doc.to_dict().get("events") or []
    return any(keyword in (event.get("title") or "").lower() for event in events for keyword in keywords)


# Ce que chaque checkpoint attend du modèle — voir le tableau des créneaux.
# Les champs non mentionnés restent remplis à null/vide (déjà imposé par le
# system prompt), le schema lui ne change pas d'un checkpoint à l'autre.
CHECKPOINT_INSTRUCTIONS = {
    "morning": "Brief complet : renseigne tous les champs (overnightMove, le calendrier events du jour, interventionRisk, note).",
    "london_open": "Renseigne uniquement overnightMove et une note courte sur l'ouverture de Londres. events peut rester vide.",
    "us_data": "Renseigne uniquement les events économiques USD/JPY restants de la journée (impact medium/high) et une note courte sur ce qui arrive à 14h30. overnightMove peut être null.",
    "ny_open": "Renseigne uniquement une note courte sur la réaction du marché aux données US du jour. overnightMove et events peuvent rester null/vide.",
    "fomc": "Renseigne uniquement une note courte sur ce qui est attendu de la décision FOMC ce soir. overnightMove et events peuvent rester null/vide.",
    "boj_watch": "Renseigne uniquement une note courte sur ce qui est attendu de la BoJ cette nuit. overnightMove et events peuvent rester null/vide.",
}


# Tarifs Sonnet 5 en $/1M tokens, tarif de lancement valable jusqu'au 31/08/2026
# (repasse à 3.0/15.0 ensuite — à ajuster ici le moment venu). Recherche web
# estimée à $10 pour 1000 recherches. Approximatif (pas de frais fixes/marge
# API pris en compte), utile pour repérer une dérive de coût, pas pour la
# facturation exacte (voir la Console Anthropic pour ça).
INPUT_PRICE_PER_MTOK = 2.0
OUTPUT_PRICE_PER_MTOK = 10.0
CACHE_READ_PRICE_PER_MTOK = 0.2
SEARCH_PRICE = 0.01


def log_usage(checkpoint, response):
    usage = response.usage
    input_tokens = usage.input_tokens
    output_tokens = usage.output_tokens
    cache_read = getattr(usage, "cache_read_input_tokens", None) or 0
    cache_creation = getattr(usage, "cache_creation_input_tokens", None) or 0
    search_count = sum(1 for b in response.content if b.type == "web_search_tool_result")

    cost = (
        (input_tokens + cache_creation) / 1_000_000 * INPUT_PRICE_PER_MTOK
        + output_tokens / 1_000_000 * OUTPUT_PRICE_PER_MTOK
        + cache_read / 1_000_000 * CACHE_READ_PRICE_PER_MTOK
        + search_count * SEARCH_PRICE
    )
    print(
        f"[USAGE] '{checkpoint}' — in={input_tokens} out={output_tokens} "
        f"cache_read={cache_read} recherches={search_count} coût≈${cost:.4f}"
    )


def generate_brief(checkpoint):
    client = Anthropic(api_key=ANTHROPIC_API_KEY)
    instruction = CHECKPOINT_INSTRUCTIONS.get(checkpoint, "Renseigne les champs pertinents pour ce créneau.")
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": 4}],
        output_config={"format": {"type": "json_schema", "schema": BRIEF_SCHEMA}, "effort": "medium"},
        messages=[
            {
                "role": "user",
                "content": f"Checkpoint : {checkpoint}. Date : {today_key()}. {instruction}",
            }
        ],
    )

    log_usage(checkpoint, response)

    if response.stop_reason == "refusal":
        raise RuntimeError(f"Refus du modèle : {response.stop_details}")

    text_blocks = [b.text for b in response.content if b.type == "text"]
    if not text_blocks:
        raise RuntimeError("Aucun bloc texte dans la réponse Claude")

    # Dernier bloc texte = la réponse finale, une fois les recherches terminées.
    return json.loads(text_blocks[-1])


def write_brief(db, checkpoint, brief):
    db.collection("dailyBrief").document(today_key()).collection("checkpoints").document(checkpoint).set(brief)


def run(checkpoint):
    from google.cloud import firestore

    if not ANTHROPIC_API_KEY:
        raise SystemExit("[ERREUR] anthropic_key.txt introuvable (ou ANTHROPIC_API_KEY absent).")
    if not os.path.exists(SA_PATH):
        raise SystemExit(f"[ERREUR] {SA_PATH} introuvable.")

    db = firestore.Client.from_service_account_json(SA_PATH)

    keywords = CONDITIONAL_TRIGGERS.get(checkpoint)
    if keywords and not morning_detected_event(db, keywords):
        print(f"[SKIP] '{checkpoint}' — aucun événement détecté dans le morning brief du jour")
        return

    brief = generate_brief(checkpoint)
    write_brief(db, checkpoint, brief)

    notify(f"Brief macro — {checkpoint}", brief["note"])
    print(f"[OK] Brief '{checkpoint}' écrit pour {today_key()}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage : python daily_brief.py <checkpoint>")
    checkpoint_arg = sys.argv[1]
    if checkpoint_arg not in CHECKPOINT_INSTRUCTIONS:
        valid = ", ".join(CHECKPOINT_INSTRUCTIONS)
        raise SystemExit(f"[ERREUR] checkpoint inconnu : '{checkpoint_arg}' (attendu : {valid})")
    run(checkpoint_arg)
