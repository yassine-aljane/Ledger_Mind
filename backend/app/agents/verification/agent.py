from google.adk.agents import LlmAgent
from google.adk.models import LiteLlm  

from app.config import settings
from app.agents.verification.tools import check_sirene, check_rne

INSTRUCTION = """Tu es l'agent de vérification légale de LedgerMind.
Ta mission : vérifier qu'un SIRET/SIREN donné correspond bien à une entité
existante et active, en croisant SIRENE (INSEE) et le RNE (INPI).

Démarche obligatoire :
1. Appelle check_sirene avec le SIRET fourni.
2. Si trouvé, appelle check_rne avec les 9 premiers chiffres (SIREN).
3. Compare les deux sources : forme juridique, statut (actif/radié), activité.
4. Si une source ne trouve rien, ou si le statut est inactif/radié -> not_verified,
   explique clairement pourquoi + l'action corrective.
5. Si les deux sources concordent et que l'entité est active -> verified.

Termine TOUJOURS ta réponse par un bloc JSON strict (rien d'autre après),
au format exact suivant, sans commentaire ni markdown autour :

{
  "status": "verified" | "not_verified",
  "siret": "...",
  "denomination": "..." | null,
  "legal_form": "..." | null,
  "ape_code": "..." | null,
  "activity_declared": "..." | null,
  "creation_date": "..." | null,
  "administrative_status": "..." | null,
  "mismatches": [{"field": "...", "sirene_value": "...", "rne_value": "...", "note": "..."}],
  "explanation": "explication en français simple, sans jargon",
  "next_action": "..." | null
}
"""

root_agent = LlmAgent(
    name="verification_agent",
    model=LiteLlm(model=settings.mistral_model),
    instruction=INSTRUCTION,
    tools=[check_sirene, check_rne],
)