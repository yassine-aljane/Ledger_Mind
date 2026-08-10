"""Point d'entrée public de la transparence IA — article 50 du règlement (UE) 2024/1689.

Deux besoins distincts servis ici :

* le frontend lit `/api/ai-act/transparence` pour afficher la mention de divulgation et la
  page « Transparence » sans dupliquer les textes réglementaires dans le code TypeScript ;
* un auditeur, un vérificateur ou un partenaire lit le même point d'entrée pour constater
  ce qui est effectivement marqué, et par quel moyen. Le guide demande de documenter où et
  comment la divulgation est présentée : cette réponse *est* cette documentation, produite
  par le code plutôt que rédigée à côté de lui — elle ne peut donc pas dériver.

Aucune authentification : une obligation de transparence qui ne serait consultable qu'après
connexion ne remplirait pas son office.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core import ai_act

router = APIRouter(prefix="/api/ai-act", tags=["ai-act"])


@router.get("/transparence")
async def transparence() -> dict:
    """État du dispositif de marquage, textes de divulgation inclus."""
    return ai_act.etat_transparence()
