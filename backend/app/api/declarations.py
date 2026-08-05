"""API de l'agent déclaratif — brouillons prêts à recopier, jamais transmis.

Distinct de `/api/declaration` (préparation 2042-C-PRO fondée sur le CA facturé, chantier
antérieur) : ici l'assiette est le CA ENCAISSÉ et les cinq déclarations sont couvertes.

Aucun endpoint ne transmet quoi que ce soit à l'administration. Il n'en existe pas, et c'est
délibéré : la validation et l'envoi restent des gestes humains.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.agents.declarations import generer_declarations, revenus_ue, store
from app.agents.declarations.calendrier import calendrier, prochaine
from app.agents.declarations.contexte import (
    contexte_depuis_profil,
    informations_manquantes,
)
from app.agents.declarations.pdf import brouillon_to_pdf, jeu_to_pdf
from app.agents.declarations.schemas import DemandeDeclarations, JeuDeclarations
from app.agents.facture import store as facture_store
from app.agents.rapport_fiscal import rapprochement
from app.agents.rapport_fiscal import sources as pieces
from app.api.deps import get_current_user
from app.schemas.auth import UserPublic
from app.schemas.orchestrator import UserProfile

router = APIRouter(prefix="/api/declarations", tags=["declarations"])


def _profil(user: UserPublic) -> UserProfile | None:
    """Profil déclaré à l'onboarding, ou `None` si le parcours n'a rien enregistré."""
    brut = user.agent_context.intake.profile
    if not brut:
        return None
    try:
        return UserProfile.model_validate(brut)
    except Exception:  # noqa: BLE001 — un profil illisible ne doit pas bloquer les brouillons
        return None


@router.get("/contexte")
async def contexte_prerempli(user: UserPublic = Depends(get_current_user)):
    """Situation déclarative telle que l'onboarding la connaît, pour préremplir l'écran.

    Préremplissage, pas contrainte : l'utilisateur corrige, et sa correction fait autorité.
    """
    profil = _profil(user)
    if profil is None:
        return {"contexte": None, "informations_manquantes": [], "profil_disponible": False}
    return {
        "contexte": contexte_depuis_profil(profil).model_dump(mode="json"),
        "informations_manquantes": informations_manquantes(profil),
        "profil_disponible": True,
        "denomination": profil.denomination,
        "siren": profil.siren,
    }


@router.get("/echeances")
async def echeances(
    annee: int | None = None,
    user: UserPublic = Depends(get_current_user),
):
    """Calendrier des déclarations dues sur l'année.

    Les périodes viennent des RÈGLES et de la périodicité déclarée à la création — jamais d'un
    réglage d'écran. C'est à chacune de ces échéances qu'un document est produit.
    """
    profil = _profil(user)
    contexte = contexte_depuis_profil(profil) if profil else None
    aujourdhui = date.today()
    cible = annee or aujourdhui.year

    creation = None
    if contexte and contexte.date_creation:
        try:
            creation = date.fromisoformat(str(contexte.date_creation)[:10])
        except ValueError:
            creation = None

    # Les mois porteurs d'un revenu européen conditionnent les échéances de DES : sans revenu
    # intracommunautaire, il n'y a pas de DES à zéro.
    virements = pieces.virements(user.id)
    mois_ue = {
        int(r.date[5:7]) for r in revenus_ue.detecter(virements)
        if r.date and r.date[:4] == str(cible)
    }

    liste = calendrier(
        cible,
        frequence=(contexte.frequence if contexte else "trimestrielle"),
        regime_tva=("reel_normal" if contexte and contexte.assujetti_tva else None),
        date_creation=creation,
        mois_avec_revenu_ue=mois_ue,
    )
    prochaine_echeance = prochaine(liste, aujourdhui)

    # CA encaissé de CHAQUE période. Sans lui, une échéance à 0 € est indiscernable d'une
    # panne : l'utilisateur ne peut pas voir que son chiffre d'affaires est sur un autre
    # trimestre. Le rapprochement est calculé une fois, puis découpé par période.
    factures = facture_store.lister_emises(user.id)
    ca_par_echeance = {}
    for e in liste:
        resultat = rapprochement.rapprocher(
            factures, virements, e.periode_debut, e.periode_fin
        )
        ca_par_echeance[(e.type, e.periode_debut.isoformat())] = resultat.ca_encaisse

    annuel = rapprochement.rapprocher(factures, virements, date(cible, 1, 1), date(cible, 12, 31))

    echeances_json = []
    for e in liste:
        brut = e.to_dict(aujourdhui)
        brut["ca_encaisse"] = ca_par_echeance[(e.type, e.periode_debut.isoformat())]
        echeances_json.append(brut)

    return {
        "annee": cible,
        "aujourdhui": aujourdhui.isoformat(),
        "frequence": contexte.frequence if contexte else "trimestrielle",
        "frequence_source": "profil d'onboarding" if contexte else "valeur par défaut",
        "ca_annuel_encaisse": annuel.ca_encaisse,
        "echeances": echeances_json,
        "prochaine": prochaine_echeance.to_dict(aujourdhui) if prochaine_echeance else None,
    }


@router.post("", response_model=JeuDeclarations)
async def generer(
    demande: DemandeDeclarations,
    user: UserPublic = Depends(get_current_user),
):
    """Produit les brouillons des cinq déclarations pour la période, et les archive."""
    try:
        jeu = generer_declarations(user.id, demande, profil=_profil(user))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if demande.enregistrer:
        store.enregistrer(jeu)
    return jeu


@router.get("")
async def lister(user: UserPublic = Depends(get_current_user)):
    """Jeux de déclarations archivés, du plus récent au plus ancien."""
    return {"jeux": store.lister(user.id)}


@router.get("/{jeu_id}", response_model=JeuDeclarations)
async def obtenir(jeu_id: str, user: UserPublic = Depends(get_current_user)):
    jeu = store.obtenir(user.id, jeu_id)
    if jeu is None:
        raise HTTPException(status_code=404, detail="Jeu de déclarations introuvable.")
    return jeu


def _emetteur(user: UserPublic) -> dict:
    """Identité portée sur le document. Sans elle, aucune signature n'engage personne."""
    profil = _profil(user)
    if profil is None:
        return {}
    return {
        "denomination": profil.denomination,
        "siren": profil.siren,
        "adresse": profil.company_address or profil.registry_address,
        "numero_tva_intracom": profil.numero_tva_intracommunautaire,
    }


@router.get("/{jeu_id}/dossier.pdf")
async def dossier_pdf(jeu_id: str, user: UserPublic = Depends(get_current_user)):
    """Dossier complet : toutes les déclarations applicables, prêtes à viser."""
    brut = store.obtenir(user.id, jeu_id)
    if brut is None:
        raise HTTPException(status_code=404, detail="Jeu de déclarations introuvable.")

    jeu = JeuDeclarations.model_validate(brut)
    nom = f"declarations_{jeu.date_debut}_{jeu.date_fin}.pdf"
    return Response(
        content=jeu_to_pdf(jeu, _emetteur(user)),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{nom}"'},
    )


@router.get("/{jeu_id}/{type_declaration}.pdf")
async def document_pdf(
    jeu_id: str,
    type_declaration: str,
    user: UserPublic = Depends(get_current_user),
):
    """UNE déclaration, en document signable par l'expert-comptable."""
    brut = store.obtenir(user.id, jeu_id)
    if brut is None:
        raise HTTPException(status_code=404, detail="Jeu de déclarations introuvable.")

    jeu = JeuDeclarations.model_validate(brut)
    brouillon = next((b for b in jeu.brouillons if b.type == type_declaration), None)
    if brouillon is None:
        raise HTTPException(
            status_code=404,
            detail=f"Aucune déclaration « {type_declaration} » dans ce jeu.",
        )

    nom = f"{type_declaration}_{jeu.date_debut}_{jeu.date_fin}.pdf"
    return Response(
        content=brouillon_to_pdf(brouillon, jeu, _emetteur(user)),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{nom}"'},
    )


@router.delete("/{jeu_id}")
async def supprimer(jeu_id: str, user: UserPublic = Depends(get_current_user)):
    if not store.supprimer(user.id, jeu_id):
        raise HTTPException(status_code=404, detail="Jeu de déclarations introuvable.")
    return {"supprime": True}
