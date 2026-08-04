"""API de génération de facture — espace influenceur immatriculé (SIREN vérifié).

L'émetteur vient du profil de la branche A (intake), jamais ressaisi : sans SIREN vérifié,
l'entreprise n'existe pas légalement et aucune facture ne peut être émise en son nom.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app.agents.facture import generator, reglementaire, store
from app.agents.facture.generator import DonneesEmetteurIncompletes, generer_facture
from app.agents.facture.pdf import facture_to_pdf
from app.agents.facture.schemas import Facture, FactureRequest
from app.api.deps import get_current_user
from app.schemas.auth import UserPublic
from app.schemas.orchestrator import UserProfile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/facture", tags=["facture"])


def _profil_emetteur(user: UserPublic) -> UserProfile:
    """Profil vérifié de l'émetteur — snapshot léger tenu sur le compte (branche intake)."""
    brut = user.agent_context.intake.profile
    if not brut:
        raise HTTPException(
            status_code=409,
            detail="Vérifiez d'abord votre SIREN : aucune identité d'entreprise vérifiée n'est "
                   "associée à ce compte.",
        )
    return UserProfile.model_validate(brut)


@router.post("")
async def creer_facture(
    payload: FactureRequest,
    user: UserPublic = Depends(get_current_user),
):
    """Génère une facture depuis le modèle standard de la plateforme (voie par défaut)."""
    profil = _profil_emetteur(user)
    numero = store.prochain_numero(user.id)
    try:
        facture = generer_facture(user.id, numero, profil, payload)
    except DonneesEmetteurIncompletes as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    store.enregistrer(facture)
    return facture


@router.post("/depuis-template")
async def creer_facture_depuis_template(
    payload: FactureRequest,
    template: UploadFile,
    user: UserPublic = Depends(get_current_user),
):
    """Génère une facture à partir d'un template uploadé (image ou fichier).

    Le template n'est JAMAIS bloquant : toute erreur d'analyse retombe silencieusement sur le
    modèle standard. Pour l'instant, l'analyse de mise en page personnalisée n'est pas implémentée
    — le repli est donc systématique, mais déjà correctement câblé pour ne jamais faire échouer
    l'émission (voir template_source / template_upload_note sur la facture renvoyée).
    """
    profil = _profil_emetteur(user)
    numero = store.prochain_numero(user.id)

    note: str | None = None
    try:
        contenu = await template.read()
        if not contenu:
            raise ValueError("fichier vide")
        # Analyse de template : non implémentée pour l'instant (chantier futur). On le signale
        # sans jamais bloquer — c'est la garantie demandée en 1.1.
        note = "Analyse de template non disponible pour l'instant : modèle standard utilisé."
    except Exception as exc:  # noqa: BLE001 — le template ne doit jamais bloquer l'émission
        logger.info("Template de facture ignoré (%s) : %s", template.filename, exc)
        note = f"Template illisible ({exc}) : modèle standard utilisé."

    try:
        facture = generer_facture(
            user.id, numero, profil, payload,
            template_source="upload", template_upload_note=note,
        )
    except DonneesEmetteurIncompletes as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    store.enregistrer(facture)
    return facture


@router.post("/brouillon")
async def creer_brouillon(payload: FactureRequest, user: UserPublic = Depends(get_current_user)):
    """Crée un BROUILLON : modifiable, sans numéro, sans existence fiscale.

    Aucun numéro n'est consommé ici — c'est ce qui garantit qu'une création abandonnée
    ne laisse pas de trou dans la séquence.
    """
    profil = _profil_emetteur(user)
    try:
        brouillon = generator.construire_document(user.id, profil, payload)
    except DonneesEmetteurIncompletes as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    store.enregistrer(brouillon)
    return {"facture": brouillon, "champs_manquants": generator.champs_manquants(payload, profil)}


@router.put("/brouillon/{facture_id}")
async def modifier_brouillon(
    facture_id: str, payload: FactureRequest, user: UserPublic = Depends(get_current_user)
):
    """Remplace le contenu d'un brouillon. Une facture émise est immuable."""
    existant = store.obtenir(user.id, facture_id)
    if not existant:
        raise HTTPException(status_code=404, detail="Brouillon introuvable.")
    if existant.get("statut") != "brouillon":
        raise HTTPException(
            status_code=409,
            detail="Cette facture est émise : elle ne se modifie plus. "
                   "Émettez un avoir pour la corriger.",
        )
    profil = _profil_emetteur(user)
    brouillon = generator.construire_document(user.id, profil, payload, facture_id=facture_id)
    store.enregistrer(brouillon)
    return {"facture": brouillon, "champs_manquants": generator.champs_manquants(payload, profil)}


@router.delete("/brouillon/{facture_id}", status_code=204)
async def supprimer_brouillon(facture_id: str, user: UserPublic = Depends(get_current_user)):
    """Supprime un brouillon. Une facture émise n'est jamais supprimée (traçabilité légale)."""
    if not store.supprimer_brouillon(user.id, facture_id):
        raise HTTPException(
            status_code=409,
            detail="Seul un brouillon peut être supprimé ; une facture émise se corrige par avoir.",
        )
    return Response(status_code=204)


@router.delete("/{facture_id}")
async def supprimer_facture(
    facture_id: str,
    confirmer_suppression_emise: bool = False,
    user: UserPublic = Depends(get_current_user),
):
    """Supprime un document de la liste ET de la base.

    Un **brouillon** part sans condition : il n'a aucune existence fiscale.

    Une facture **émise** est un autre sujet. La supprimer crée un trou dans la séquence de
    numérotation, que la réglementation interdit, et prive le rapport fiscal de la pièce à
    laquelle un encaissement se rattache — le virement correspondant deviendra un « virement
    sans facture ». L'appel exige donc `confirmer_suppression_emise=true`, et le numéro retiré
    est consigné (`factures_supprimees`) pour rester justifiable lors d'un contrôle.

    La voie conforme reste l'AVOIR : il annule les effets de la facture en la laissant
    archivée, sans rompre la séquence.
    """
    facture = store.obtenir(user.id, facture_id)
    if facture is None:
        raise HTTPException(status_code=404, detail="Facture introuvable.")

    if facture.get("statut") != "brouillon" and not confirmer_suppression_emise:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{facture.get('numero') or 'Ce document'} est émis : le supprimer laisse un "
                "trou dans votre numérotation, ce que la réglementation interdit. La correction "
                "conforme est l'avoir. Confirmez explicitement pour supprimer malgré tout."
            ),
        )

    supprime = store.supprimer_facture(user.id, facture_id)
    if supprime is None:
        raise HTTPException(status_code=404, detail="Facture introuvable.")

    logger.warning(
        "FACTURE_SUPPRIMEE uid=%s id=%s numero=%s statut=%s",
        user.id, facture_id, supprime.get("numero"), supprime.get("statut"),
    )
    return {
        "supprime": True,
        "numero": supprime.get("numero"),
        "statut": supprime.get("statut"),
        "trace_conservee": supprime.get("statut") != "brouillon",
    }


@router.get("/suppressions")
async def lister_suppressions(user: UserPublic = Depends(get_current_user)):
    """Numéros retirés de la séquence — de quoi justifier chaque trou lors d'un contrôle."""
    return {"suppressions": store.numeros_supprimes(user.id)}


@router.post("/{facture_id}/emettre")
async def emettre_facture(facture_id: str, user: UserPublic = Depends(get_current_user)):
    """Émet le brouillon : attribue le numéro de séquence, fige et date le document.

    C'est ce jalon — et lui seul — qui donne au document son existence fiscale.
    """
    brut = store.obtenir(user.id, facture_id)
    if not brut:
        raise HTTPException(status_code=404, detail="Facture introuvable.")
    if brut.get("statut") != "brouillon":
        raise HTTPException(status_code=409, detail="Cette facture est déjà émise.")

    facture = Facture.model_validate(brut)
    numero = store.prochain_numero(user.id, facture.type_document)
    emission = date.today()
    delai = facture.delai_paiement_jours
    if delai is None:
        delai = reglementaire.delai_paiement_defaut()

    store.marquer(user.id, facture_id, {
        "numero": numero,
        "statut": "emise",
        "date_emission": emission.isoformat(),
        "date_echeance": (
            facture.date_echeance.isoformat() if facture.date_echeance
            else (emission + timedelta(days=delai)).isoformat()
        ),
        "delai_paiement_jours": delai,
    })
    return store.obtenir(user.id, facture_id)


@router.post("/{facture_id}/avoir")
async def creer_avoir(
    facture_id: str, payload: FactureRequest, user: UserPublic = Depends(get_current_user)
):
    """Émet un AVOIR annulant tout ou partie d'une facture.

    La facture d'origine n'est jamais supprimée ni modifiée dans son contenu : elle passe
    au statut « annulée » et porte la référence de l'avoir. Les deux documents restent
    archivés, chacun dans sa propre séquence.
    """
    origine = store.obtenir(user.id, facture_id)
    if not origine:
        raise HTTPException(status_code=404, detail="Facture d'origine introuvable.")
    if origine.get("statut") == "brouillon":
        raise HTTPException(
            status_code=409,
            detail="Un brouillon n'a pas d'existence légale : supprimez-le au lieu de l'annuler.",
        )
    if origine.get("avoir_numero"):
        raise HTTPException(
            status_code=409,
            detail=f"Cette facture est déjà annulée par l'avoir {origine['avoir_numero']}.",
        )

    profil = _profil_emetteur(user)
    numero = store.prochain_numero(user.id, "avoir")
    avoir = generator.construire_document(
        user.id, profil, payload,
        type_document="avoir",
        numero=numero,
        statut="emise",
        date_emission=date.today(),
        facture_origine_numero=origine.get("numero"),
    )
    store.enregistrer(avoir)
    store.marquer(user.id, facture_id, {"statut": "annulee", "avoir_numero": numero})
    return {"avoir": avoir, "facture_origine": store.obtenir(user.id, facture_id)}


class ReglementBody(BaseModel):
    montant: float = Field(gt=0, description="Montant encaissé, en euros")


@router.post("/{facture_id}/reglement")
async def enregistrer_reglement(
    facture_id: str, body: ReglementBody, user: UserPublic = Depends(get_current_user)
):
    """Constate un encaissement et met le statut à jour.

    Le rapprochement automatique avec les virements relève de l'agent aval ; cet endpoint
    couvre la saisie manuelle (paiement en espèces, par exemple).
    """
    brut = store.obtenir(user.id, facture_id)
    if not brut:
        raise HTTPException(status_code=404, detail="Facture introuvable.")
    if brut.get("statut") not in store.STATUTS_EMIS:
        raise HTTPException(
            status_code=409, detail="Seule une facture émise peut recevoir un règlement."
        )

    regle = round(float(brut.get("montant_regle") or 0) + body.montant, 2)
    du = float(brut.get("net_a_payer") or 0)
    statut = "payee" if regle >= du - 0.01 else "partiellement_payee"
    store.marquer(user.id, facture_id, {"montant_regle": regle, "statut": statut})
    return store.obtenir(user.id, facture_id)


@router.get("/contexte")
async def contexte_facturation(user: UserPublic = Depends(get_current_user)):
    """Ce que le profil impose à la facture : régime de TVA, taux à appliquer, mentions.

    Sert à ce que l'écran de saisie n'invente rien. Le taux de TVA n'est pas une préférence
    de l'utilisateur : il découle de son régime, déclaré à l'onboarding. Une saisie libre
    ferait émettre des factures avec de la TVA sous franchise, ou l'inverse.

    `franchise` vaut `null` quand le régime n'est pas qualifié : ni franchise, ni assujetti.
    L'écran doit alors demander la réponse, pas trancher à la place de l'utilisateur.
    """
    profil = _profil_emetteur(user)
    franchise = generator.franchise_tva(profil)

    # Informations de l'onboarding qui manquent à la facture. Une facture incomplète n'est
    # pas conforme : mieux vaut le dire ici que laisser l'utilisateur le découvrir au PDF.
    manquants: list[dict[str, str]] = []
    if franchise is None:
        manquants.append({
            "champ": "regime_tva",
            "libelle": "Régime de TVA (franchise en base ou assujetti)",
            "consequence": "Sans lui, la facture ne peut porter ni la mention 293 B, ni un taux.",
        })
    if not (profil.invoicing_iban or "").strip():
        manquants.append({
            "champ": "invoicing_iban",
            "libelle": "IBAN de règlement",
            "consequence": "La facture sort sans coordonnées bancaires.",
        })
    if franchise is False and not (profil.numero_tva_intracommunautaire or "").strip():
        manquants.append({
            "champ": "numero_tva_intracommunautaire",
            "libelle": "N° de TVA intracommunautaire",
            "consequence": (
                f"Obligatoire au-delà de {reglementaire.seuil_dispense_tva_intracom():.0f} € HT."
            ),
        })

    return {
        "franchise_tva": franchise,
        # Sous franchise, le taux est nécessairement nul et la mention 293 B remplace la TVA.
        # Assujetti, aucun taux n'est imposé par le régime : il dépend de la prestation.
        "taux_tva_impose": 0.0 if franchise else None,
        "mention_tva": reglementaire.mention_franchise_tva() if franchise else None,
        "base_legale": reglementaire.mention_franchise_tva() if franchise else None,
        "denomination": profil.denomination,
        "siren": profil.siren,
        "regime": profil.recommended_regime,
        "delai_paiement_defaut": reglementaire.delai_paiement_defaut(),
        "seuil_dispense_tva_intracom": reglementaire.seuil_dispense_tva_intracom(),
        "champs_profil_manquants": manquants,
        "provenance": reglementaire.provenance(),
    }


@router.get("/alerte-tva")
async def alerte_tva(user: UserPublic = Depends(get_current_user)):
    """Position du CA facturé face au seuil de franchise — informatif, jamais décisionnel.

    Le seuil porte sur le CA ENCAISSÉ : la plateforme ne peut que signaler, le régime
    reste déclaré par l'utilisateur.
    """
    emises = store.lister_emises(user.id)
    ca_ht = round(sum(float(f.get("total_ht") or 0) for f in emises), 2)
    categorie = "vente" if any(
        ligne.get("categorie") == "vente" for f in emises for ligne in (f.get("lignes") or [])
    ) else "services"
    return {
        "ca_facture_ht": ca_ht,
        "categorie": categorie,
        "alerte": generator.alerte_seuil_tva(ca_ht, categorie),
        "provenance": reglementaire.provenance(),
    }


@router.get("")
async def lister_factures(
    depuis: str | None = None,
    jusqua: str | None = None,
    emises_seulement: bool = False,
    user: UserPublic = Depends(get_current_user),
):
    """Factures de l'utilisateur, filtrables par période.

    `emises_seulement` restreint aux documents ayant une existence fiscale — c'est ce que
    doivent consommer les rapports d'activité, la déclaration et le rapprochement bancaire.
    """
    if emises_seulement:
        return {"factures": store.lister_emises(user.id, depuis=depuis, jusqua=jusqua)}
    return {"factures": store.lister(user.id, depuis=depuis, jusqua=jusqua)}


@router.get("/{facture_id}")
async def obtenir_facture(facture_id: str, user: UserPublic = Depends(get_current_user)):
    facture = store.obtenir(user.id, facture_id)
    if not facture:
        raise HTTPException(status_code=404, detail="Facture introuvable.")
    return facture


@router.get("/{facture_id}/pdf")
async def facture_pdf(facture_id: str, user: UserPublic = Depends(get_current_user)):
    from app.agents.facture.schemas import Facture

    brut = store.obtenir(user.id, facture_id)
    if not brut:
        raise HTTPException(status_code=404, detail="Facture introuvable.")
    facture = Facture.model_validate(brut)
    pdf = facture_to_pdf(facture)
    return StreamingResponse(
        iter([pdf]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=facture_{facture.numero}.pdf"},
    )
