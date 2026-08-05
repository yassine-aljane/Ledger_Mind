"""Génération des cinq brouillons de déclaration.

L'assiette est le **CA ENCAISSÉ**, obtenu par le rapprochement facture ↔ virement déjà en
place (`app.agents.rapport_fiscal`). Les montants dus viennent du moteur d'impôt
(`app.agents.impots.tools`). Ce module n'écrit AUCUNE formule fiscale : il assemble des
formulaires.

Ce qu'il refuse de faire, et pourquoi :

  * **déduire l'abattement avant de remplir une case** — les cases 5KO/5KP/5HQ attendent le CA
    brut, l'administration applique l'abattement. Le déduire l'appliquerait deux fois ;
  * **inventer un numéro de case** — le CA3 n'a pas été recoupé, ses champs sont donc donnés
    comme structure, marqués « à vérifier » ;
  * **fusionner les lignes de CA en activité mixte** — trois natures, trois taux ;
  * **taire une déclaration à 0 €** — celle du CA URSSAF reste obligatoire, et l'omettre coûte
    une pénalité alors qu'aucune somme n'est due.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from app.agents.facture import store as facture_store
from app.agents.impots import constantes as C
from app.agents.impots import tools as moteur
from app.agents.rapport_fiscal import rapprochement as rappro
from app.agents.rapport_fiscal import sources as pieces
from app.schemas.orchestrator import UserProfile

from . import revenus_ue as ue
from . import sources as pieces_decl
from .schemas import (
    Brouillon,
    ChampBrouillon,
    ContexteDeclaratif,
    DemandeDeclarations,
    JeuDeclarations,
    Rappel,
    RevenuUE,
)

_AVERTISSEMENT = (
    "BROUILLON préparé à partir de vos pièces — CE N'EST PAS UNE DÉCLARATION TRANSMISE. "
    "Vérifiez chaque montant, puis recopiez-le vous-même sur le site officiel. La validation "
    "et la transmission restent entièrement de votre ressort."
)

# Correspondance entre la nature d'une ligne de facture et la catégorie fiscale.
_CATEGORIE = {"vente": "BIC_VENTE", "prestation": None}


def _eur(montant: float) -> str:
    return f"{montant:,.2f}".replace(",", " ").replace(".", ",") + " €"


def _ventiler(ca_par_nature: Dict[str, float], contexte: ContexteDeclaratif) -> Dict[str, float]:
    """CA par CATÉGORIE FISCALE. Les trois natures restent séparées, jamais fusionnées."""
    ventile: Dict[str, float] = {}
    for nature, montant in ca_par_nature.items():
        if montant <= 0:
            continue
        categorie = _CATEGORIE.get(nature) or contexte.categorie_par_defaut
        ventile[categorie] = round(ventile.get(categorie, 0.0) + montant, 2)
    return ventile


def _annee_activite(date_creation: Optional[str], a_la_date: date) -> Optional[int]:
    """Rang de l'année d'activité (1 = première). Sert aux exonérations de CFP et de CFE."""
    if not date_creation:
        return None
    try:
        creation = date.fromisoformat(str(date_creation)[:10])
    except ValueError:
        return None
    return a_la_date.year - creation.year + 1


# --------------------------------------------------------------- 1. CA URSSAF
def _brouillon_ca_urssaf(
    ventile: Dict[str, float], prelevements: Dict[str, Any],
    contexte: ContexteDeclaratif, debut: date, fin: date, nb_encaissements: int,
) -> Brouillon:
    bloc = C.declarations()["declaration_ca_urssaf"]
    libelles = bloc["lignes"]

    champs = [
        ChampBrouillon(
            libelle="Période déclarée",
            valeur=f"{debut.isoformat()} → {fin.isoformat()}",
            unite=None,
            provenance=f"Fréquence déclarée : {contexte.frequence}",
        )
    ]
    # Les TROIS lignes figurent toujours, y compris à zéro : le téléservice les demande
    # séparément, et une case laissée vide n'a pas le même sens qu'une case à 0.
    for categorie, libelle in libelles.items():
        montant = ventile.get(categorie, 0.0)
        champs.append(ChampBrouillon(
            libelle=libelle,
            valeur=montant,
            provenance=(
                f"{nb_encaissements} encaissement(s) rapproché(s) sur la période"
                if montant > 0 else "aucun encaissement de cette nature sur la période"
            ),
        ))
    champs.append(ChampBrouillon(
        libelle="Option versement libératoire de l'impôt sur le revenu",
        valeur=contexte.option_versement_liberatoire, unite=None,
        provenance="Choix enregistré lors de votre parcours d'onboarding",
    ))

    vigilance: List[str] = []
    if prelevements.get("ca_total", 0) == 0:
        vigilance.append(bloc["note_zero"])
    if prelevements.get("cfp_exoneree"):
        vigilance.append(
            f"CFP exonérée : première année d'activité et CA cumulé sous "
            f"{_eur(prelevements['seuil_cfp_premiere_annee'])}."
        )
    if not C.tfcc_bloc().get("verifie"):
        vigilance.append(
            "Le taux de TFCC provient d'une valeur NON recoupée avec la source officielle : "
            "vérifiez le montant annoncé par l'URSSAF avant de payer."
        )

    return Brouillon(
        type="ca_urssaf",
        titre="Déclaration de chiffre d'affaires (URSSAF)",
        teleservice=bloc["teleservice"],
        lien=bloc["source"],
        periode_debut=debut.isoformat(), periode_fin=fin.isoformat(),
        frequence=contexte.frequence,
        champs=champs,
        montant_a_payer=prelevements.get("total_a_payer"),
        points_de_vigilance=vigilance,
        provenance={"assiette": "CA encaissé rapproché", "calcul": "app.agents.impots"},
    )


# --------------------------------------------------- 2. Déclaration de revenus
def _brouillon_revenus(
    ventile: Dict[str, float], contexte: ContexteDeclaratif, debut: date, fin: date,
    annee_complete: bool,
) -> Brouillon:
    bloc = C.declarations()["declaration_revenus"]
    champs: List[ChampBrouillon] = []

    for categorie, montant in sorted(ventile.items()):
        definition = bloc["cases"].get(categorie)
        if not definition:
            continue
        champs.append(ChampBrouillon(
            case=definition["case"],
            libelle=definition["libelle"],
            # LE point à ne pas manquer : montant BRUT. L'abattement est appliqué par
            # l'administration ; le déduire ici le compterait deux fois.
            valeur=montant,
            provenance=f"CA encaissé {debut.year}, catégorie {categorie} — montant BRUT",
            note="Reportez le CA brut : l'abattement est appliqué par l'administration.",
        ))

    if not champs:
        champs.append(ChampBrouillon(
            libelle="Aucun chiffre d'affaires encaissé sur la période",
            valeur=0.0,
            provenance="Aucun encaissement rapproché",
            note="La déclaration annuelle reste obligatoire, même à 0 €.",
        ))

    vigilance = [
        "Reportez le CA BRUT dans chaque case : ne déduisez jamais l'abattement vous-même.",
        f"Échéance {bloc['echeance']} — la date exacte dépend de votre département et change "
        "chaque année ; vérifiez-la sur impots.gouv.fr.",
    ]
    if not annee_complete:
        vigilance.append(
            "La période analysée ne couvre pas l'année civile entière : cette déclaration "
            "porte sur l'année complète, complétez avec le reste de vos encaissements."
        )
    if contexte.option_versement_liberatoire:
        vigilance.append(
            "Vous avez opté pour le versement libératoire : cette déclaration reste "
            "obligatoire, le CA y est reporté à titre informatif."
        )

    return Brouillon(
        type="revenus_2042",
        titre="Déclaration annuelle des revenus (2042-C-PRO)",
        formulaire=bloc["formulaire"], cerfa=bloc["cerfa"],
        lien=bloc["source"],
        periode_debut=debut.isoformat(), periode_fin=fin.isoformat(),
        frequence="annuelle",
        echeance=bloc["echeance"],
        champs=champs,
        points_de_vigilance=vigilance,
        provenance={"cases_verifiees_le": bloc["date_verif"], "source": bloc["source"]},
    )


# ------------------------------------------------------------------- 3. DES
def _brouillon_des(
    revenus: List[RevenuUE], contexte: ContexteDeclaratif, debut: date, fin: date,
) -> Brouillon:
    bloc = C.declarations()["des"]

    if not revenus:
        return Brouillon(
            type="des", titre="Déclaration européenne de services (DES)",
            teleservice=bloc["teleservice"], lien=bloc["source"],
            periode_debut=debut.isoformat(), periode_fin=fin.isoformat(),
            frequence="mensuelle",
            applicable=False,
            motif_non_applicable=(
                "Aucun encaissement provenant d'une entité établie dans l'Union européenne "
                "n'a été détecté sur la période."
            ),
        )

    champs = [ChampBrouillon(
        libelle="N° de TVA intracommunautaire du déclarant",
        valeur=contexte.numero_tva_intracom, unite=None,
        provenance="Profil utilisateur",
        note=None if contexte.numero_tva_intracom else bloc["note_numero_requis"],
    )]

    for groupe in ue.par_contrepartie(revenus).values():
        suffixe = "" if groupe["certain"] else " — À CONFIRMER"
        champs.append(ChampBrouillon(
            libelle=f"Preneur : {groupe['contrepartie']}{suffixe}",
            valeur=groupe["montant_eur"],
            provenance=(
                f"{groupe['nombre']} encaissement(s), pays {groupe['pays'] or 'non identifié'}"
                + (f", {groupe['plateforme']}" if groupe.get("plateforme") else "")
            ),
            fiabilite="confirmee" if groupe["certain"] else "a_verifier",
        ))
        # Le n° de TVA DU CLIENT est exigé par le formulaire, et la plateforme ne le connaît
        # pas : il figure sur la facture du preneur, pas sur le virement reçu.
        champs.append(ChampBrouillon(
            libelle=f"    N° de TVA du preneur — {groupe['contrepartie']}",
            valeur=None, unite=None,
            provenance=(
                "Non détectable depuis un virement : relevez-le sur la facture ou le relevé "
                "de la plateforme."
            ),
            fiabilite="a_verifier",
        ))
        champs.append(ChampBrouillon(
            libelle=f"    Pays du preneur — {groupe['contrepartie']}",
            valeur=groupe["pays"], unite=None,
            provenance=(
                "Déduit de l'IBAN émetteur" if groupe["certain"]
                else "Déduit du libellé — à confirmer"
            ),
            fiabilite="confirmee" if groupe["certain"] else "a_verifier",
        ))

    vigilance = [
        bloc["note_aucun_paiement"],
        "Le n° de TVA de chaque preneur est obligatoire sur la DES et n'est pas détectable "
        "automatiquement : complétez-le depuis la facture ou le relevé de la plateforme.",
        "Un oubli de DES est traité comme une infraction fiscale, avec des majorations "
        "potentiellement lourdes — malgré son caractère purement informatif.",
    ]
    if not contexte.numero_tva_intracom:
        vigilance.insert(0, bloc["note_numero_requis"])
    if any(not r.certain for r in revenus):
        vigilance.append(
            "Certains rattachements reposent sur le libellé du virement, pas sur un IBAN "
            "étranger : confirmez le pays d'établissement du payeur sur son justificatif."
        )

    return Brouillon(
        type="des", titre="Déclaration européenne de services (DES)",
        teleservice=bloc["teleservice"], lien=bloc["source"],
        periode_debut=debut.isoformat(), periode_fin=fin.isoformat(),
        frequence="mensuelle", echeance=bloc["echeance"],
        champs=champs,
        montant_a_payer=None,  # déclaration informative : aucun paiement
        points_de_vigilance=vigilance,
        provenance={"detection": "IBAN émetteur, puis libellé de la contrepartie"},
    )


# --------------------------------------------------------------- 4. TVA (CA3)
def _brouillon_tva(
    contexte: ContexteDeclaratif, debut: date, fin: date,
    collectee: Dict[str, Any], deductible: Dict[str, Any],
) -> Brouillon:
    bloc = C.declarations()["declaration_tva"]

    if not contexte.assujetti_tva:
        return Brouillon(
            type="tva_ca3", titre="Déclaration de TVA (CA3)",
            formulaire=bloc["formulaire"], cerfa=bloc["cerfa"], lien=bloc["source"],
            periode_debut=debut.isoformat(), periode_fin=fin.isoformat(),
            frequence=contexte.frequence,
            applicable=False,
            motif_non_applicable=(
                "Vous relevez de la franchise en base de TVA : aucune déclaration de TVA "
                "n'est due tant que votre régime n'a pas changé."
            ),
        )

    nette = round(collectee["total"] - deductible["total"], 2)

    # Les montants sont chiffrés depuis les pièces ; les NUMÉROS DE CASE, eux, restent
    # inconnus. On donne donc des valeurs sûres sur des références qui ne le sont pas — d'où
    # la fiabilité « à vérifier » sur chaque ligne.
    champs = [
        ChampBrouillon(
            libelle="TVA collectée sur les opérations imposables",
            valeur=collectee["total"],
            provenance=(
                f"{len(collectee['lignes'])} facture(s) émise(s) sur la période, "
                f"base HT {_eur(collectee['base_ht'])}"
            ),
            fiabilite="a_verifier",
        ),
        ChampBrouillon(
            libelle="TVA déductible sur les biens et services",
            valeur=deductible["total"],
            provenance=(
                f"{len(deductible['lignes'])} facture(s) d'achat capturée(s)"
                + (f", {deductible['pieces_sans_tva_lue']} sans TVA lisible"
                   if deductible["pieces_sans_tva_lue"] else "")
            ),
            fiabilite="a_verifier",
            note=deductible["reserve"],
        ),
        ChampBrouillon(
            libelle="TVA nette due (collectée − déductible)",
            valeur=nette,
            provenance=f"{_eur(collectee['total'])} − {_eur(deductible['total'])}",
            fiabilite="a_verifier",
            note=("Crédit de TVA : montant négatif, à reporter ou à demander en "
                  "remboursement." if nette < 0 else None),
        ),
    ]

    vigilance = [
        bloc["note_cases"],
        deductible["reserve"],
        "La TVA des prestations de services est exigible à l'ENCAISSEMENT. Ce brouillon "
        "s'appuie sur les factures ÉMISES de la période : ajustez si des factures n'ont pas "
        "encore été payées.",
    ]
    if deductible["pieces_sans_tva_lue"]:
        vigilance.append(
            f"{deductible['pieces_sans_tva_lue']} facture(s) d'achat sans montant de TVA "
            "lisible : elles ne sont PAS comptées. Une TVA illisible n'est pas une TVA nulle."
        )

    return Brouillon(
        type="tva_ca3", titre="Déclaration de TVA (CA3)",
        formulaire=bloc["formulaire"], cerfa=bloc["cerfa"], lien=bloc["source"],
        periode_debut=debut.isoformat(), periode_fin=fin.isoformat(),
        frequence=contexte.frequence,
        champs=champs,
        montant_a_payer=nette if nette > 0 else None,
        points_de_vigilance=vigilance,
        provenance={"cases_confirmees": False, "taux_normal": bloc.get("taux_normal")},
    )


# ------------------------------------------------------------------- 5. CFE
def _brouillon_cfe(contexte: ContexteDeclaratif, debut: date, fin: date,
                   annee_activite: Optional[int], ca_annuel: float) -> Brouillon:
    bloc = C.declarations()["cfe"]

    if annee_activite == 1:
        return Brouillon(
            type="cfe", titre="Cotisation foncière des entreprises (CFE)",
            lien=bloc["source"],
            periode_debut=debut.isoformat(), periode_fin=fin.isoformat(),
            frequence="annuelle",
            applicable=False,
            motif_non_applicable=(
                "Première année d'activité : vous en êtes exonéré d'office. Aucun rappel, "
                "aucune démarche."
            ),
        )

    return Brouillon(
        type="cfe", titre="Cotisation foncière des entreprises (CFE)",
        lien=bloc["source"],
        periode_debut=debut.isoformat(), periode_fin=fin.isoformat(),
        frequence="annuelle", echeance=bloc["echeance"],
        champs=[
            # Les trois données dont dépend le barème communal. Deux sont connues, la
            # troisième — la commune — ne l'est que par l'adresse déclarée.
            ChampBrouillon(
                libelle="Année d'activité",
                valeur=annee_activite, unite=None,
                provenance=(
                    f"Créée le {contexte.date_creation}" if contexte.date_creation
                    else "Date de création non renseignée"
                ),
                fiabilite="confirmee" if annee_activite else "a_verifier",
            ),
            ChampBrouillon(
                libelle="Commune d'implantation",
                valeur=contexte.departement and f"département {contexte.departement}",
                unite=None,
                provenance=(
                    "Déduite de l'adresse de votre profil — le barème est voté par la "
                    "COMMUNE, pas par le département : vérifiez-la."
                ),
                fiabilite="a_verifier",
            ),
            ChampBrouillon(
                libelle="Chiffre d'affaires annuel (base du barème)",
                valeur=round(ca_annuel, 2),
                provenance=f"CA encaissé sur l'année {debut.year}",
            ),
            ChampBrouillon(
                libelle="Montant de la CFE", valeur=None,
                provenance="Barème communal — calculé et notifié par l'administration",
                fiabilite="a_verifier",
                note=bloc["motif_non_calculable"],
            ),
        ],
        montant_a_payer=None,  # non calculable : barème voté commune par commune
        points_de_vigilance=[
            bloc["motif_non_calculable"],
            f"Aucune déclaration périodique : le formulaire {bloc['formulaire_initial']} ne se "
            "remplit qu'une fois, à la création.",
            f"À régler en {bloc['echeance']}, depuis votre espace professionnel impots.gouv.fr.",
        ],
        provenance={"montant_calculable": False},
    )


# ------------------------------------------------------------------ Rappels
def _rappels_recoupement(ecart: Optional[Dict[str, Any]]) -> List[Rappel]:
    """Divergence avec un rapport déjà établi sur la MÊME période.

    Deux chiffres différents pour une même période signifient qu'une pièce a bougé entre
    les deux. Déclarer sans le savoir, c'est déclarer un montant qu'on ne saura pas
    justifier.
    """
    if not ecart or ecart["concordant"]:
        return []
    return [Rappel(
        declaration="ca_urssaf",
        titre="Écart avec un rapport fiscal déjà établi",
        priorite="haute",
        message=(
            f"Le rapport du {(ecart.get('genere_le') or '')[:10]} annonçait "
            f"{_eur(ecart['ca_du_rapport'])} sur cette période, contre "
            f"{_eur(ecart['ca_declare'])} ici — soit {_eur(abs(ecart['ecart']))} d'écart. "
            "Une pièce a été ajoutée, corrigée ou supprimée entre les deux : identifiez "
            "laquelle avant de déclarer."
        ),
    )]


def _rappels(brouillons: List[Brouillon], revenus: List[RevenuUE],
             contexte: ContexteDeclaratif) -> List[Rappel]:
    rappels: List[Rappel] = []
    par_type = {b.type: b for b in brouillons}

    ca_urssaf = par_type.get("ca_urssaf")
    if ca_urssaf:
        rappels.append(Rappel(
            declaration="ca_urssaf",
            titre="Déclaration de chiffre d'affaires URSSAF",
            priorite="normale",
            message=(
                "À déclarer selon votre périodicité "
                f"({contexte.frequence}). Elle reste obligatoire même à 0 €."
            ),
            lien=ca_urssaf.lien,
        ))

    # La démarche du numéro de TVA intracom précède la perception : elle passe donc devant.
    if revenus and not contexte.numero_tva_intracom:
        rappels.append(Rappel(
            declaration="des",
            titre="PRIORITAIRE : demandez un n° de TVA intracommunautaire",
            priorite="haute",
            message=(
                "Un encaissement provenant de l'Union européenne a été détecté alors que vous "
                "n'avez pas de numéro de TVA intracommunautaire. La démarche est gratuite, "
                "auprès de votre service des impôts des entreprises — et certaines plateformes "
                "ne peuvent pas activer le paiement sans lui."
            ),
        ))

    des = par_type.get("des")
    if des and des.applicable:
        rappels.append(Rappel(
            declaration="des", titre="Déclaration européenne de services",
            priorite="haute", echeance=des.echeance,
            message=(
                f"{len(revenus)} encaissement(s) d'origine européenne détecté(s) : DES à "
                f"déposer avant le {des.echeance}. Aucun paiement, mais l'obligation existe "
                "même sous franchise de TVA."
            ),
            lien=des.lien,
        ))

    tva = par_type.get("tva_ca3")
    if tva and tva.applicable:
        rappels.append(Rappel(
            declaration="tva_ca3", titre="Déclaration de TVA (CA3)",
            priorite="normale",
            message="Vous êtes redevable de la TVA : la déclaration CA3 est due sur la période.",
            lien=tva.lien,
        ))

    revenus_2042 = par_type.get("revenus_2042")
    if revenus_2042:
        rappels.append(Rappel(
            declaration="revenus_2042",
            titre="Déclaration annuelle des revenus (2042-C-PRO)",
            priorite="normale", echeance=revenus_2042.echeance,
            message=(
                "Une fois par an, quelle que soit votre option d'imposition. La date limite "
                "dépend de votre département et change chaque année."
            ),
            lien=revenus_2042.lien,
        ))

    cfe = par_type.get("cfe")
    if cfe and cfe.applicable:
        rappels.append(Rappel(
            declaration="cfe", titre="Cotisation foncière des entreprises",
            priorite="normale", echeance=cfe.echeance,
            message="À régler en décembre. Le montant est notifié par l'administration.",
            lien=cfe.lien,
        ))

    return rappels


# ---------------------------------------------------------------- Assemblage
def generer_declarations(
    uid: str, demande: DemandeDeclarations, profil: UserProfile | None = None
) -> JeuDeclarations:
    """Produit les brouillons des cinq déclarations pour la période demandée."""
    debut = date.fromisoformat(demande.date_debut)
    fin = date.fromisoformat(demande.date_fin)
    contexte = demande.contexte

    # -- Assiette : le CA ENCAISSÉ, via le rapprochement déjà en place -------------------
    factures = facture_store.lister_emises(uid)
    virements = pieces.virements(uid)
    resultat = rappro.rapprocher(factures, virements, debut, fin)
    ventile = _ventiler(resultat.ca_par_categorie, contexte)

    # -- Montants dus : le moteur fait foi, on recopie -----------------------------------
    annee_activite = _annee_activite(contexte.date_creation, fin)
    activites = [{"categorie": c, "ca": m} for c, m in ventile.items()] or [
        {"categorie": contexte.categorie_par_defaut, "ca": 0.0}
    ]
    prelevements = moteur.calculer_prelevements_periode(
        activites=activites,
        caisse_bnc=contexte.caisse_bnc,
        acre_active=contexte.acre_active,
        premiere_annee=annee_activite == 1,
        ca_annuel_cumule=(
            contexte.ca_annuel_cumule
            if contexte.ca_annuel_cumule is not None else resultat.ca_encaisse
        ),
        option_versement_liberatoire=contexte.option_versement_liberatoire,
    )

    revenus = ue.detecter(virements)
    # La DES porte sur le mois : on ne retient que ce qui tombe dans la période demandée.
    revenus = [
        r for r in revenus
        if r.date and debut.isoformat() <= r.date[:10] <= fin.isoformat()
    ]

    annee_complete = (
        debut.month == 1 and debut.day == 1
        and fin.month == 12 and fin.day == 31 and debut.year == fin.year
    )

    # -- Sources complémentaires exigées par le guide -----------------------------------
    collectee = pieces_decl.tva_collectee(factures, debut, fin)
    recues = pieces_decl.factures_recues(uid, debut, fin)
    deductible = pieces_decl.tva_deductible(recues)
    contrats = pieces_decl.contrats_actifs(uid, debut, fin)
    rapports = pieces_decl.rapports_couvrant(uid, debut, fin)
    ecart_rapport = pieces_decl.ecart_avec_rapport(
        resultat.ca_encaisse, rapports, debut, fin
    )
    # La CFE s'assoit sur le CA de l'ANNÉE, pas sur celui de la période déclarée.
    ca_annuel = rappro.rapprocher(
        factures, virements, date(debut.year, 1, 1), date(debut.year, 12, 31),
    ).ca_encaisse

    brouillons = [
        _brouillon_ca_urssaf(ventile, prelevements, contexte, debut, fin,
                             len(resultat.encaissements)),
        _brouillon_revenus(ventile, contexte, debut, fin, annee_complete),
        _brouillon_des(revenus, contexte, debut, fin),
        _brouillon_tva(contexte, debut, fin, collectee, deductible),
        _brouillon_cfe(contexte, debut, fin, annee_activite, ca_annuel),
    ]

    # Une période à zéro alors que l'année en compte n'est pas une panne : c'est un fait, mais
    # il doit être DIT. Sans cela, l'utilisateur croit l'outil cassé au lieu de comprendre que
    # son chiffre d'affaires se trouve sur une autre période.
    if resultat.ca_encaisse <= 0:
        annuel = rappro.rapprocher(
            factures, virements, date(debut.year, 1, 1), date(debut.year, 12, 31),
        )
        if annuel.ca_encaisse > 0:
            periodes = sorted({
                (e.date_valeur or "")[:7] for e in annuel.encaissements if e.date_valeur
            })
            hypotheses_zero = (
                f"Aucun encaissement sur cette période, alors que {_eur(annuel.ca_encaisse)} "
                f"ont été encaissés sur l'année {debut.year} — en "
                f"{', '.join(periodes) or 'une autre période'}. La déclaration de CETTE "
                "période reste due, à 0 €."
            )
        else:
            hypotheses_zero = (
                f"Aucun encaissement rapproché sur l'année {debut.year}. Si vous avez été "
                "payé, vérifiez que vos virements sont bien capturés et rattachés à une "
                "facture émise."
            )
    else:
        hypotheses_zero = None

    hypotheses = [
        "L'assiette est le CA ENCAISSÉ : seuls les virements reçus et rapprochés d'une facture "
        "sont comptés. Une facture émise et non payée comptera lors de son encaissement.",
        "Aucun montant n'est calculé par cet agent : ils viennent tous du moteur d'impôt.",
        "Aucune déclaration n'est transmise : vous recopiez et validez vous-même.",
    ]
    if hypotheses_zero:
        hypotheses.insert(0, hypotheses_zero)
    if annee_activite is None:
        hypotheses.append(
            "Date de création non renseignée : l'exonération de CFP la première année et celle "
            "de CFE n'ont pas pu être appliquées. Renseignez-la pour un brouillon exact."
        )

    return JeuDeclarations(
        id=uuid.uuid4().hex,
        uid=uid,
        date_debut=demande.date_debut,
        date_fin=demande.date_fin,
        genere_le=datetime.now(timezone.utc).isoformat(),
        frequence=contexte.frequence,
        ca_encaisse=resultat.ca_encaisse,
        ca_par_categorie=ventile,
        brouillons=brouillons,
        rappels=_rappels(brouillons, revenus, contexte) + _rappels_recoupement(ecart_rapport),
        revenus_ue=revenus,
        prelevements=prelevements,
        tva_collectee=collectee,
        tva_deductible=deductible,
        contrats_actifs=contrats,
        recoupement_rapport=ecart_rapport,
        avertissement=_AVERTISSEMENT,
        hypotheses=hypotheses,
        provenance=prelevements.get("provenance", {}),
    )
