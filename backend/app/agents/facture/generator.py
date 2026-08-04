"""Construction déterministe d'une facture — aucun montant ni mention n'est laissé au LLM.

Les mentions viennent de la fiche officielle service-public.fr F31808 « Mentions obligatoires
sur une facture » (Direction de l'information légale et administrative — Premier ministre).
Leur texte et les montants réglementaires vivent dans `data/facturation.yaml`, avec leur source
et leur date de contrôle : ce module ne fait que calculer et mettre en forme.

Le LLM n'intervient nulle part ici.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from app.agents.facture import reglementaire
from app.agents.facture.schemas import (
    Acompte,
    Facture,
    FactureRequest,
    LigneFacture,
    MentionFacture,
)
from app.schemas.orchestrator import UserProfile


class DonneesEmetteurIncompletes(ValueError):
    """Le profil ne porte pas assez d'informations pour émettre une facture légale."""


class TransitionInterdite(ValueError):
    """L'opération demandée n'est pas permise dans l'état actuel du document."""


def _ligne_totaux(ligne: LigneFacture) -> tuple[float, float, float]:
    """HT après remise, TVA, TTC — la remise s'applique avant la TVA."""
    brut = ligne.quantite * ligne.prix_unitaire_ht
    ht = round(brut * (1 - ligne.remise_pourcent / 100), 2)
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


def franchise_tva(profil: UserProfile, assujetti_declare: bool | None = None) -> bool | None:
    """L'émetteur relève-t-il de la franchise en base de TVA ?

    Trois réponses possibles, et `None` en est une : **régime indéterminé**. Tant que le
    parcours n'a pas qualifié le régime, on ne tranche pas — auparavant, un régime inconnu
    était traité comme « assujetti », ce qui produisait une facture SANS AUCUNE mention de
    TVA : ni l'article 293 B, ni un taux. Un tel document n'est pas conforme.

    DÉCLARATIF, jamais déduit d'un calcul de chiffre d'affaires : le seuil porte sur le CA
    ENCAISSÉ, que la plateforme ne connaît pas de façon fiable (une facture émise n'est pas
    une facture payée). Basculer seul exposerait l'utilisateur à facturer sans TVA alors
    qu'il la doit — ou l'inverse.

    `assujetti_declare`, quand il est fourni, fait autorité sur le régime du profil.

    Ordre des sources, du plus fiable au moins fiable :

      1. `assujetti_declare` — décision explicite pour CE document ;
      2. `profil.regime_tva` — régime DÉCLARÉ pendant l'onboarding. C'est une réponse de
         l'utilisateur, pas une déduction : elle fait foi ;
      3. `profil.recommended_regime` — repli heuristique (« micro » dans le libellé). Il
         confond le régime d'imposition et le régime de TVA : un micro-entrepreneur ayant
         dépassé le seuil est au micro-BIC ET assujetti à la TVA. D'où la priorité donnée
         au champ déclaratif ci-dessus.
    """
    if assujetti_declare is not None:
        return not assujetti_declare

    regime_tva = (getattr(profil, "regime_tva", None) or "").strip().lower()
    if regime_tva:
        return regime_tva == "franchise"

    regime = (profil.recommended_regime or "").strip().lower()
    if not regime:
        return None
    return "micro" in regime


def alerte_seuil_tva(ca_facture_ht: float, categorie: str) -> dict | None:
    """Signale l'approche ou le dépassement du seuil de franchise — sans jamais décider.

    Renvoie `None` si le seuil est loin. Sinon un avertissement destiné à l'utilisateur,
    à qui revient la déclaration de son régime.
    """
    seuils = reglementaire.seuils_franchise_tva()
    bloc = seuils.get("vente" if categorie == "vente" else "services") or {}
    base = bloc.get("seuil_base")
    majore = bloc.get("seuil_majore")
    if base is None:
        return None

    if majore is not None and ca_facture_ht > majore:
        niveau, message = "depasse_majore", (
            f"Chiffre d'affaires facturé ({ca_facture_ht:.0f} €) au-dessus du seuil majoré "
            f"({majore} €) : la TVA devient exigible dès le premier jour du dépassement."
        )
    elif ca_facture_ht > base:
        niveau, message = "depasse_base", (
            f"Chiffre d'affaires facturé ({ca_facture_ht:.0f} €) au-dessus du seuil de base "
            f"({base} €) : vérifiez votre régime de TVA."
        )
    elif ca_facture_ht > base * 0.9:
        niveau, message = "proche", (
            f"Chiffre d'affaires facturé ({ca_facture_ht:.0f} €) proche du seuil de franchise "
            f"({base} €)."
        )
    else:
        return None

    return {
        "niveau": niveau,
        "message": message,
        "seuil_base": base,
        "seuil_majore": majore,
        "note": "Le seuil porte sur le CA ENCAISSÉ ; ce calcul se fonde sur le CA facturé.",
        "source": (seuils.get("source") or ""),
    }


def construire_mentions(
    profil: UserProfile,
    requete: FactureRequest,
    total_ht: float,
    total_tva: float,
    *,
    en_franchise: bool | None = None,
) -> tuple[list[MentionFacture], bool]:
    """Construit la liste de mentions légales réellement affichées, chacune sourcée.

    Renvoie aussi `tva_intracom_requise` (dépend du total HT, donc calculé ici).
    """
    source = reglementaire.source_principale()
    mentions: list[MentionFacture] = []
    tva_intracom_requise = total_ht > reglementaire.seuil_dispense_tva_intracom()

    franchise = franchise_tva(profil) if en_franchise is None else en_franchise
    if franchise is None:
        # Une facture doit TOUJOURS se prononcer sur la TVA. Faute de régime qualifié, on
        # le dit sur le document au lieu de laisser un blanc que rien ne signale.
        mentions.append(MentionFacture(
            cle="regime_tva_indetermine", libelle="Régime de TVA",
            valeur="À PRÉCISER avant envoi — franchise en base (art. 293 B du CGI) "
                   "ou assujetti ? Le régime n'est pas encore qualifié sur votre profil.",
            source=source,
        ))
    elif franchise:
        mentions.append(MentionFacture(
            cle="franchise_tva", libelle="Régime de TVA",
            valeur=reglementaire.mention_franchise_tva(), source=source,
        ))
    elif requete.client.numero_tva_intracom:
        mentions.append(MentionFacture(
            cle="autoliquidation", libelle="TVA",
            valeur=reglementaire.mention_autoliquidation(), source=source,
        ))
    elif total_tva <= 0:
        # Assujetti mais aucune TVA facturée : soit un taux a été oublié, soit le régime
        # est mal renseigné. Dans les deux cas, le document ne peut pas rester muet.
        mentions.append(MentionFacture(
            cle="tva_absente", libelle="TVA",
            valeur="Aucune TVA facturée alors que le régime n'est pas la franchise en base : "
                   "vérifiez les taux de TVA de vos lignes.",
            source=source,
        ))

    mentions.append(MentionFacture(
        cle="escompte", libelle="Conditions d'escompte",
        valeur=requete.conditions_escompte or reglementaire.mention_escompte_neant(),
        source=source,
    ))
    mentions.append(MentionFacture(
        cle="penalites_retard", libelle="Pénalités de retard",
        valeur=reglementaire.mention_penalites(), source=source,
    ))

    # L'indemnité forfaitaire de recouvrement n'est due qu'ENTRE PROFESSIONNELS : la
    # mentionner face à un particulier serait une mention abusive.
    if requete.client.est_professionnel or reglementaire.indemnite_due_aux_particuliers():
        mentions.append(MentionFacture(
            cle="indemnite_recouvrement", libelle="Indemnité de recouvrement",
            valeur=reglementaire.indemnite_recouvrement_mention(), source=source,
        ))

    if requete.membre_association_agreee:
        mentions.append(MentionFacture(
            cle="association_agreee", libelle="Association agréée",
            valeur=reglementaire.mention_association_agreee(), source=source,
        ))

    if not requete.client.est_professionnel:
        mentions.append(MentionFacture(
            cle="garantie_legale", libelle="Garantie légale",
            valeur=reglementaire.mention_garantie_legale(), source=source,
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


def champs_manquants(
    requete: FactureRequest, profil: UserProfile | None = None
) -> list[str]:
    """Mentions obligatoires absentes, à remonter à l'utilisateur.

    Aucune n'est complétée en silence : une mention légale devinée engagerait l'émetteur.
    """
    manquants: list[str] = []
    if requete.client.est_professionnel and not requete.client.siret:
        manquants.append("SIRET du client professionnel")
    if not requete.client.adresse:
        manquants.append("adresse du client")

    if profil is not None:
        if franchise_tva(profil) is None:
            manquants.append(
                "régime de TVA (franchise en base ou assujetti) — non qualifié sur le profil"
            )
        # Au-delà du seuil de dispense, le n° de TVA intracommunautaire du VENDEUR devient
        # obligatoire : le réclamer plutôt que d'imprimer « requis » sans valeur.
        total_ht = sum(_ligne_totaux(l)[0] for l in requete.lignes)
        # `numero_tva_intracom` n'existe pas sur UserProfile : le `getattr` avec valeur par
        # défaut renvoyait donc TOUJOURS None, et la mention était signalée manquante même
        # quand l'utilisateur l'avait renseignée à l'onboarding.
        if total_ht > reglementaire.seuil_dispense_tva_intracom() and not (
            profil.numero_tva_intracommunautaire or ""
        ).strip():
            manquants.append(
                "n° de TVA intracommunautaire du vendeur "
                f"(obligatoire au-delà de {reglementaire.seuil_dispense_tva_intracom():.0f} € HT)"
            )
    return manquants


def _echeance(requete: FactureRequest, emission: date) -> tuple[date, int | None]:
    """Date d'échéance et délai retenu — mention obligatoire (conditions de règlement)."""
    if requete.date_echeance:
        return requete.date_echeance, requete.delai_paiement_jours
    delai = requete.delai_paiement_jours
    if delai is None:
        delai = reglementaire.delai_paiement_defaut()
    return emission + timedelta(days=delai), delai


def construire_document(
    uid: str,
    profil: UserProfile,
    requete: FactureRequest,
    *,
    type_document: str = "facture",
    numero: str | None = None,
    statut: str = "brouillon",
    date_emission: date | None = None,
    facture_origine_numero: str | None = None,
    en_franchise: bool | None = None,
    template_source: str = "standard",
    template_upload_note: str | None = None,
    facture_id: str | None = None,
) -> Facture:
    """Assemble un document complet : montants calculés, mentions sourcées, rien d'inventé.

    Sert aussi bien au brouillon (sans numéro ni date d'émission) qu'au document émis.
    Sur un AVOIR, les montants sont portés en négatif : c'est ce qui permet de les sommer
    directement avec les factures pour obtenir un chiffre d'affaires net.
    """
    valider_profil_emetteur(profil)

    signe = -1 if type_document == "avoir" else 1

    total_ht = 0.0
    total_tva = 0.0
    for ligne in requete.lignes:
        ht, tva, _ = _ligne_totaux(ligne)
        total_ht += ht
        total_tva += tva
    total_ht = round(total_ht * signe, 2)
    total_tva = round(total_tva * signe, 2)
    total_ttc = round(total_ht + total_tva, 2)

    acompte: Acompte | None = requete.acompte
    net_a_payer = round(total_ttc - (acompte.montant_ttc if acompte else 0.0), 2)

    regime = franchise_tva(profil) if en_franchise is None else en_franchise
    mentions, tva_intracom_requise = construire_mentions(
        profil, requete, abs(total_ht), abs(total_tva), en_franchise=regime,
    )
    nom_emetteur, forme = _forme_juridique_mention(profil)

    emission = date_emission
    echeance, delai = (None, requete.delai_paiement_jours)
    if emission is not None:
        echeance, delai = _echeance(requete, emission)

    return Facture(
        id=facture_id or f"{uid}_{uuid.uuid4().hex[:12]}",
        uid=uid,
        numero=numero,
        type_document=type_document,  # type: ignore[arg-type]
        statut=statut,                # type: ignore[arg-type]
        date_emission=emission,
        date_prestation=requete.date_prestation or emission or date.today(),
        emetteur_nom=nom_emetteur,
        emetteur_forme_juridique=forme,
        emetteur_siren=profil.siren or "",
        emetteur_adresse=profil.registry_address,
        emetteur_capital_social=None,  # micro-entreprise : pas de capital social (EI)
        # `None` (régime non qualifié) ne vaut PAS « assujetti » : le drapeau dédié le dit,
        # et la mention correspondante figure sur le document.
        emetteur_franchise_tva=bool(regime if regime is not None else False),
        regime_tva_indetermine=regime is None,
        # Les `getattr` visaient des noms absents de UserProfile (`numero_tva_intracom`,
        # `iban`) : ils renvoyaient toujours None, et la facture sortait sans IBAN ni n° de
        # TVA même une fois ces informations collectées à l'onboarding.
        emetteur_tva_intracom=profil.numero_tva_intracommunautaire,
        emetteur_iban=profil.invoicing_iban,
        # Le n° de POLICE d'assurance RC pro n'est collecté nulle part : l'onboarding ne
        # demande que son existence (`professional_liability_insurance`), et `rcs_rm_number`
        # est une immatriculation, pas une police. Le laisser vide plutôt qu'imprimer un
        # numéro qui n'est pas celui attendu.
        emetteur_rc_pro=None,
        client=requete.client,
        lignes=requete.lignes,
        total_ht=total_ht,
        total_tva=total_tva,
        total_ttc=total_ttc,
        acompte=acompte,
        net_a_payer=net_a_payer,
        tva_intracom_requise=tva_intracom_requise,
        date_echeance=echeance,
        delai_paiement_jours=delai,
        mode_paiement=requete.mode_paiement,
        numero_contrat=requete.numero_contrat,
        numero_bon_commande=requete.numero_bon_commande,
        facture_origine_numero=facture_origine_numero,
        mentions=mentions,
        template_source=template_source,
        template_upload_note=template_upload_note,
        created_at=datetime.now(timezone.utc).isoformat(),
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
    """Émet directement une facture numérotée (voie historique, conservée telle quelle)."""
    return construire_document(
        uid, profil, requete,
        numero=numero,
        statut="emise",
        date_emission=date.today(),
        template_source=template_source,
        template_upload_note=template_upload_note,
    )
