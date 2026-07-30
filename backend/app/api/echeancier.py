"""API du Centre d'Actions — agenda fiscal, confirmation de paiement, historique.

Espace immatriculé (SIREN vérifié) : le moteur ne fait que préparer. Le bouton « Payer »/« Déclarer »
ouvre le portail officiel ; « Marquer comme payé » est une confirmation déclarative de
l'utilisateur, jamais une transmission ni un paiement effectué par LedgerMind.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.agents.declaration import store as declaration_store
from app.agents.echeancier import moteur
from app.agents.echeancier.profil import concerne_pour_profil, mettre_a_jour_parametres, profil_verifie
from app.agents.echeancier.schemas import (
    AgendaResponse,
    HistoriqueItem,
    MarquerPayeRequest,
    ParametresCalendrier,
    VeilleResponse,
)
from app.agents.echeancier.store import marquer_regularisee
from app.agents.facture import store as facture_store
from app.api.deps import get_current_user
from app.schemas.auth import UserPublic

router = APIRouter(prefix="/api/echeancier", tags=["echeancier"])


@router.get("/agenda", response_model=AgendaResponse)
async def agenda(user: UserPublic = Depends(get_current_user)):
    profil = profil_verifie(user)
    echeances = moteur.generer_agenda(user.id, profil)
    return AgendaResponse(echeances=echeances, parametres_manquants=moteur.parametres_manquants(profil))


@router.get("/veille", response_model=VeilleResponse)
async def veille_personnalisee(user: UserPublic = Depends(get_current_user)):
    """Actualités réglementaires du dernier cycle de veille, filtrées selon l'activité déclarée.

    Ne déclenche jamais de cycle elle-même (la veille tourne à part, voir `app.veille.scheduler`,
    désactivée par défaut) : cette route ne fait que lire + filtrer le dernier rapport en mémoire.
    """
    from app.veille import scheduler

    profil = profil_verifie(user)
    tags = set(concerne_pour_profil(profil))
    rapport = scheduler.dernier_rapport()
    nouveautes = [
        n for n in rapport.get("nouveautes", [])
        if set(n.get("concerne") or ["tous"]) & tags
    ]
    return VeilleResponse(date=rapport.get("date"), nouveautes=nouveautes)


@router.patch("/parametres")
async def parametres(
    valeurs: ParametresCalendrier,
    user: UserPublic = Depends(get_current_user),
):
    profil_verifie(user)  # 409 si pas encore vérifié, avant toute écriture
    profil = await mettre_a_jour_parametres(user, valeurs.model_dump(exclude_none=True))
    return {"parametres_manquants": moteur.parametres_manquants(profil)}


@router.post("/{obligation_id}/marquer-paye")
async def marquer_paye(
    obligation_id: str,
    body: MarquerPayeRequest,
    user: UserPublic = Depends(get_current_user),
):
    profil_verifie(user)
    marquer_regularisee(user.id, obligation_id, body.periode)
    return {"statut": "regularisee"}


@router.get("/historique", response_model=list[HistoriqueItem])
async def historique(user: UserPublic = Depends(get_current_user)):
    profil_verifie(user)
    items: list[HistoriqueItem] = []
    for f in facture_store.lister(user.id):
        items.append(HistoriqueItem(
            type="facture", id=f["id"], libelle=f"Facture {f['numero']} — {f['client']['nom']}",
            date=f["date_emission"], statut="emise", montant=f["total_ttc"],
        ))
    for d in declaration_store.lister(user.id):
        items.append(HistoriqueItem(
            type="declaration", id=d["id"], libelle=f"Déclaration {d['date_debut']} → {d['date_fin']}",
            date=d["date_fin"], statut=d["statut"], montant=d["total_ca_declare"],
        ))
    items.sort(key=lambda i: i.date, reverse=True)
    return items
