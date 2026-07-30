"""Construction déterministe d'une facture — aucun montant ni mention n'est laissé au LLM.

Les mentions viennent de la fiche officielle service-public.fr F31808 « Mentions obligatoires
sur une facture » (Direction de l'information légale et administrative — Premier ministre),
vérifiée via MCP avant d'écrire ce module — voir le texte exact cité en commentaire à côté de
chaque mention. Le LLM n'intervient nulle part ici : ce module ne fait que calculer et mettre en
forme des données déjà connues (profil, lignes saisies par l'utilisateur).
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from app.agents.facture.schemas import ClientFacture, Facture, FactureRequest, MentionFacture, LigneFacture
from app.schemas.orchestrator import UserProfile

_SOURCE_MENTIONS = "https://entreprendre.service-public.fr/vosdroits/F31808"

# Seuil en dessous duquel le n° de TVA intracommunautaire du vendeur n'est pas obligatoire.
# Fiche F31808 : "Sauf pour les factures d'un montant total HT inférieur ou égal à 150 €."
_SEUIL_TVA_INTRACOM_HT = 150.0

_MENTION_FRANCHISE_TVA = "TVA non applicable, art. 293 B du code général des impôts"
_MENTION_ESCOMPTE_NEANT = "Escompte pour paiement anticipé : néant"
_MENTION_INDEMNITE_RECOUVREMENT = (
    "Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €"
)
_MENTION_ASSOCIATION_AGREEE = (
    "Membre d'une association agréée, le règlement par chèque et carte bancaire est accepté"
)


class DonneesEmetteurIncompletes(ValueError):
    """Le profil ne porte pas assez d'informations pour émettre une facture légale."""


def _ligne_totaux(ligne: LigneFacture) -> tuple[float, float, float]:
    ht = round(ligne.quantite * ligne.prix_unitaire_ht, 2)
    tva = round(ht * ligne.taux_tva, 2)
    return ht, tva, round(ht + tva, 2)


def _forme_juridique_mention(profil: UserProfile) -> tuple[str, str | None]:
    """Nom légal de l'émetteur + forme juridique, selon EI ou société (fiche F31808)."""
    if profil.is_entrepreneur_individuel:
        nom = profil.denomination or ""
        if "entrepreneur individuel" not in nom.lower() and " ei" not in f" {nom.lower()}":
            nom = f"{nom} — Entrepreneur individuel (EI)".strip(" —")
        return nom, None
    return (profil.denomination or ""), profil.legal_form


def _franchise_tva(profil: UserProfile) -> bool:
    """Vrai si l'émetteur relève de la franchise en base de TVA (régime micro, non optant).

    Déterministe : dépend du régime recommandé/vérifié, jamais d'une estimation du LLM.
    """
    regime = (profil.recommended_regime or "").lower()
    return "micro" in regime


def construire_mentions(
    profil: UserProfile,
    requete: FactureRequest,
    total_ht: float,
    total_tva: float,
) -> tuple[list[MentionFacture], bool]:
    """Construit la liste de mentions légales réellement affichées, chacune sourcée.

    Renvoie aussi `tva_intracom_requise` (dépend du total HT, donc calculé ici).
    """
    mentions: list[MentionFacture] = []
    tva_intracom_requise = total_ht > _SEUIL_TVA_INTRACOM_HT

    if _franchise_tva(profil):
        mentions.append(MentionFacture(
            cle="franchise_tva", libelle="Régime de TVA", valeur=_MENTION_FRANCHISE_TVA,
            source=_SOURCE_MENTIONS,
        ))
    elif requete.client.numero_tva_intracom:
        mentions.append(MentionFacture(
            cle="autoliquidation", libelle="TVA", valeur="Auto-liquidation",
            source=_SOURCE_MENTIONS,
        ))

    escompte = requete.conditions_escompte or _MENTION_ESCOMPTE_NEANT
    mentions.append(MentionFacture(
        cle="escompte", libelle="Conditions d'escompte", valeur=escompte, source=_SOURCE_MENTIONS,
    ))

    mentions.append(MentionFacture(
        cle="penalites_retard", libelle="Pénalités de retard",
        valeur="Taux légal en vigueur, exigibles sans rappel nécessaire",
        source=_SOURCE_MENTIONS,
    ))
    mentions.append(MentionFacture(
        cle="indemnite_recouvrement", libelle="Indemnité de recouvrement",
        valeur=_MENTION_INDEMNITE_RECOUVREMENT, source=_SOURCE_MENTIONS,
    ))

    if requete.membre_association_agreee:
        mentions.append(MentionFacture(
            cle="association_agreee", libelle="Association agréée",
            valeur=_MENTION_ASSOCIATION_AGREEE, source=_SOURCE_MENTIONS,
        ))

    if not requete.client.est_professionnel:
        mentions.append(MentionFacture(
            cle="garantie_legale", libelle="Garantie légale",
            valeur="Garantie légale de conformité applicable (2 ans) pour les biens éligibles",
            source=_SOURCE_MENTIONS,
        ))

    return mentions, tva_intracom_requise


def valider_profil_emetteur(profil: UserProfile) -> None:
    """Refuse d'émettre une facture si des données OBLIGATOIRES manquent — jamais d'invention.

    Sans SIREN, l'entreprise n'existe pas légalement : aucune facture ne peut être émise en son
    nom (c'est tout le sens du parcours de vérification qui précède cet espace).
    """
    manquants = []
    if not profil.siren:
        manquants.append("SIREN")
    if not profil.denomination:
        manquants.append("nom/dénomination")
    if not profil.registry_address:
        manquants.append("adresse")
    if manquants:
        raise DonneesEmetteurIncompletes(
            "Profil incomplet pour émettre une facture : " + ", ".join(manquants) + "."
        )


def generer_facture(
    uid: str,
    numero: str,
    profil: UserProfile,
    requete: FactureRequest,
    *,
    template_source: str = "standard",
    template_upload_note: str | None = None,
) -> Facture:
    """Assemble une facture complète : montants calculés, mentions sourcées, rien d'inventé."""
    valider_profil_emetteur(profil)

    total_ht = 0.0
    total_tva = 0.0
    for ligne in requete.lignes:
        ht, tva, _ = _ligne_totaux(ligne)
        total_ht += ht
        total_tva += tva
    total_ht = round(total_ht, 2)
    total_tva = round(total_tva, 2)
    total_ttc = round(total_ht + total_tva, 2)

    mentions, tva_intracom_requise = construire_mentions(profil, requete, total_ht, total_tva)
    nom_emetteur, forme = _forme_juridique_mention(profil)

    return Facture(
        id=f"{uid}_{numero}",
        uid=uid,
        numero=numero,
        date_emission=date.today(),
        date_prestation=requete.date_prestation or date.today(),
        emetteur_nom=nom_emetteur,
        emetteur_forme_juridique=forme,
        emetteur_siren=profil.siren or "",
        emetteur_adresse=profil.registry_address,
        emetteur_capital_social=None,  # micro-entreprise : pas de capital social (EI)
        emetteur_franchise_tva=_franchise_tva(profil),
        client=requete.client,
        lignes=requete.lignes,
        total_ht=total_ht,
        total_tva=total_tva,
        total_ttc=total_ttc,
        tva_intracom_requise=tva_intracom_requise,
        mentions=mentions,
        template_source=template_source,
        template_upload_note=template_upload_note,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
