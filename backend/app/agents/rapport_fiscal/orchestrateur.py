"""Orchestrateur du rapport fiscal — assemble les données, appelle le moteur, n'en refait rien.

Le calcul de l'impôt et des cotisations appartient EXCLUSIVEMENT à `app.agents.impots.tools`.
Ce module ne fait que trois choses : réunir les données réelles de l'utilisateur, construire
un payload valide, et mettre en forme ce que le moteur renvoie. Aucune formule fiscale n'est
dupliquée ici — un second calcul divergerait tôt ou tard du premier.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any, Dict, List

from app.agents.facture import store as facture_store
from app.agents.impots import tools as moteur
from app.agents.impots.constantes import CategorieFiscale
from app.core.mongo import get_db

from app.schemas.orchestrator import UserProfile

from . import acre as acre_flag
from . import rapprochement as rappro
from . import sources
from . import tva as tva_flag
from .schemas import (
    Alerte,
    CadeauRecu,
    ContexteFiscalRapport,
    DemandeRapport,
    RapportFiscal,
    SourcesRapport,
)

# Correspondance entre la nature d'une ligne de facture et la catégorie fiscale du moteur.
# Une vente de marchandises et une prestation ne relèvent ni du même abattement, ni du même
# taux de cotisations : les agréger serait faux.
_CATEGORIE_MOTEUR = {
    "vente": CategorieFiscale.bic_vente.value,
    "prestation": None,  # dépend du profil : BIC_SERVICE ou BNC (voir `categorie_par_defaut`)
}


def _capitale(texte: str) -> str:
    """Première lettre en majuscule, le reste intact — les sigles doivent survivre."""
    return texte[:1].upper() + texte[1:] if texte else texte


def _eur(montant: float) -> str:
    """Montant à la française — les alertes sont lues telles quelles, à l'écran comme en PDF."""
    return f"{montant:,.2f}".replace(",", " ").replace(".", ",") + " €"


def _virements(uid: str) -> List[Dict[str, Any]]:
    """Virements capturés de l'utilisateur. Lecture directe : le rapport n'a pas besoin du
    runtime LLM de l'agent capture, et ne doit pas en dépendre pour fonctionner."""
    return list(get_db()["virements"].find({"user_id": uid}, {"_id": 0}))


def _factures_avec_existence_fiscale(uid: str) -> List[Dict[str, Any]]:
    """Factures émises, hors brouillons et hors annulées par avoir."""
    return facture_store.lister_emises(uid)


def _activites(ca_par_categorie: Dict[str, float], contexte: ContexteFiscalRapport) -> List[Dict]:
    """Ventile le CA par catégorie fiscale, pour le moteur (activité mixte gérée nativement).

    Sans aucun encaissement, on renvoie une entrée à CA nul plutôt qu'une liste vide : le
    moteur doit tourner quand même. Un CA nul n'est pas une absence de calcul — abattement,
    cotisations, CFP et impôt valent zéro, et c'est un résultat, pas un trou.
    """
    activites: List[Dict[str, Any]] = []
    for nature, montant in ca_par_categorie.items():
        if montant <= 0:
            continue
        categorie = _CATEGORIE_MOTEUR.get(nature) or contexte.categorie_par_defaut
        existante = next((a for a in activites if a["categorie"] == categorie), None)
        if existante:
            existante["ca"] = round(existante["ca"] + montant, 2)
        else:
            activites.append({"categorie": categorie, "ca": round(montant, 2)})

    if not activites:
        activites.append({"categorie": contexte.categorie_par_defaut, "ca": 0.0})
    return activites


def _alertes(
    rapprochement, simulation: Dict[str, Any] | None, contexte: ContexteFiscalRapport
) -> List[Alerte]:
    """Alertes du rapport. Chacune décrit un fait constaté, jamais une décision prise."""
    alertes: List[Alerte] = []

    if rapprochement is not None:
        incertain = round(rapprochement.ca_encaisse - rapprochement.ca_encaisse_certain, 2)
        if incertain > 0:
            alertes.append(Alerte(
                niveau="vigilance",
                titre="Rattachements à confirmer",
                message=(
                    f"{_eur(incertain)} ont été rattachés par concordance de montant et de date, "
                    "sans référence de facture dans le libellé. Confirmez-les avant toute "
                    "déclaration."
                ),
            ))
        orphelins = [v for v in rapprochement.virements_non_retenus]
        if orphelins:
            total = sum(v.montant for v in orphelins)
            alertes.append(Alerte(
                niveau="vigilance",
                titre=f"{len(orphelins)} virement(s) écarté(s) du chiffre d'affaires",
                message=(
                    f"{_eur(total)} n'ont pas été retenus (sens de l'opération, absence de "
                    "facture correspondante ou ambiguïté). Chaque motif est détaillé ci-dessous."
                ),
            ))
        en_retard = [f for f in rapprochement.factures_impayees if f.en_retard]
        if en_retard:
            alertes.append(Alerte(
                niveau="vigilance",
                titre=f"{len(en_retard)} facture(s) en retard de paiement",
                message=(
                    f"{_eur(sum(f.reste_du for f in en_retard))} restent dus au-delà de "
                    "l'échéance. Ces montants ne comptent pas dans le CA tant qu'ils ne sont "
                    "pas encaissés."
                ),
            ))
        hors = rapprochement.virements_hors_periode
        if hors:
            total = sum(h["montant"] for h in hors)
            rattachables = [h for h in hors if h["cite_une_facture"]]
            precision = (
                f" Dont {len(rattachables)} citant un numéro de facture — élargissez la période "
                f"si l'un d'eux vous concerne (le plus proche : {rattachables[0]['date']})."
                if rattachables else ""
            )
            alertes.append(Alerte(
                niveau="info",
                titre=f"{len(hors)} virement(s) hors de la période analysée",
                message=(
                    f"{_eur(total)} datés en dehors du {rapprochement.periode_debut} → "
                    f"{rapprochement.periode_fin} n'ont pas été comptés : ils relèvent d'une "
                    f"autre période.{precision}"
                ),
            ))

        for ecart in rapprochement.ecarts:
            alertes.append(Alerte(niveau="vigilance", titre="Écart de rapprochement",
                                  message=ecart.message))

    if simulation:
        for depassement in simulation.get("depassements") or []:
            alertes.append(Alerte(
                niveau="critique",
                titre="Plafond du régime micro dépassé",
                message=(
                    f"CA de {depassement['ca']:.0f} € pour un plafond de "
                    f"{depassement['plafond']:.0f} €"
                    + (" (proratisé sur la période d'activité)" if depassement.get(
                        "plafond_proratise") else "")
                    + ". La sortie du régime suppose deux années consécutives au-dessus du "
                      "seuil : ce contrôle ne porte que sur la période demandée."
                ),
            ))
        if simulation.get("ir_bareme_calculable") is False:
            alertes.append(Alerte(
                niveau="info",
                titre="Impôt sur le revenu non calculé",
                message=(
                    "Le barème est progressif : sans le nombre de parts et les autres revenus "
                    "du foyer, aucun montant honnête ne peut être produit. Cotisations et base "
                    "imposable restent calculées."
                ),
            ))
        vl = simulation.get("versement_liberatoire") or {}
        if vl.get("eligible") is None:
            alertes.append(Alerte(
                niveau="info",
                titre="Éligibilité au versement libératoire indéterminée",
                message=(
                    "Le revenu fiscal de référence N-2 n'est pas renseigné : la comparaison "
                    "entre barème et versement libératoire ne peut pas conclure."
                ),
            ))

    if contexte.dom:
        alertes.append(Alerte(
            niveau="critique",
            titre="Activité en DOM : taux non couverts par la table de référence",
            message=(
                "Les cotisations sociales outre-mer bénéficient de taux minorés, et l'impôt "
                "d'une réfaction spécifique. Ces valeurs ne figurent pas dans la table de "
                "référence de la plateforme : les montants ci-dessous sont calculés aux taux "
                "métropolitains et SURESTIMENT vos cotisations. Faites-les confirmer avant "
                "toute déclaration."
            ),
        ))

    return alertes


def _alerte_acre(etat: Dict[str, Any]) -> List[Alerte]:
    """Statut de l'ACRE. Une exonération expirée doit se voir : elle change le taux."""
    if not etat.get("active"):
        return []

    restants = etat.get("trimestres_restants")
    if etat.get("expiree"):
        return [Alerte(
            niveau="vigilance",
            titre="Période d'ACRE arrivée à son terme",
            message=(
                f"L'exonération couvrait {etat['duree_trimestres']} trimestres civils à compter "
                f"du {etat.get('date_debut') or '—'}, soit jusqu'au "
                f"{etat.get('date_fin_estimee') or '—'}. La réduction de "
                f"{etat['reduction_pourcent']} % ne s'applique plus : le taux plein de "
                "cotisations est dû sur la période postérieure."
            ),
            source=etat.get("source"),
        )]

    reste = (
        f" Il reste {restants} trimestre(s) civil(s), jusqu'au {etat['date_fin_estimee']}."
        if restants is not None else
        " Date de début non renseignée : la durée restante ne peut pas être calculée."
    )
    return [Alerte(
        niveau="info",
        titre=f"ACRE active — réduction de {etat['reduction_pourcent']} % des cotisations",
        message=(
            # `.capitalize()` abaisserait le reste : « CSG-CRDS » deviendrait « csg-crds ».
            f"{_capitale(etat.get('approximation', ''))}."
            f"{reste} En toute rigueur la CSG-CRDS reste due : l'estimation est donc "
            "légèrement favorable."
        ),
        source=etat.get("source"),
    )]


def _prorata(
    contexte: ContexteFiscalRapport,
    profil: UserProfile | None,
    controle: Dict[str, Any],
) -> Dict[str, Any]:
    """Prorata de première année — appliqué ou non, l'état est toujours donné.

    Le plafond proratisé vient du moteur (`verifier_plafonds`) : rien n'est recalculé ici.
    """
    jours = contexte.jours_activite
    applique = any(p.get("plafond_proratise") for p in controle.get("plafonds") or [])
    return {
        "applique": applique,
        "jours_activite": jours,
        "date_creation": getattr(profil, "activity_start_date", None) if profil else None,
        "methode": "plafond × (jours d'activité / 365)" if applique else None,
        "plafonds_proratises": [
            {"categorie": p["categorie"], "plafond": p["plafond"]}
            for p in controle.get("plafonds") or []
            if p.get("plafond_proratise")
        ],
        "note": (
            "Le prorata ne porte QUE sur le plafond du régime : les taux d'abattement, de "
            "cotisations et de CFP restent inchangés."
            if applique
            else "Aucun prorata : le plafond annuel plein s'applique. Renseignez vos jours "
                 "d'activité si l'entreprise a été créée en cours d'année."
        ),
    }


def _alertes_pieces(pieces: SourcesRapport) -> List[Alerte]:
    """Ce que les contrats et les dépenses révèlent, sans jamais toucher à l'assiette."""
    alertes: List[Alerte] = []

    salariat = sources.contrats_de_salariat(pieces.contrats)
    if salariat:
        alertes.append(Alerte(
            niveau="vigilance",
            titre=f"{len(salariat)} contrat(s) de travail sur la période",
            message=(
                "Un salaire n'est pas du chiffre d'affaires : il se déclare séparément, dans "
                "les traitements et salaires. Il n'est donc PAS compté ici — mais il entre "
                "dans le revenu du foyer, qui conditionne l'impôt au barème."
            ),
        ))

    autres = [c for c in pieces.contrats if c not in salariat and (c.montant_eur or 0) > 0]
    if autres:
        engage = round(sum(c.montant_eur or 0 for c in autres), 2)
        alertes.append(Alerte(
            niveau="info",
            titre=f"{_eur(engage)} engagés par contrat sur la période",
            message=(
                "Montant contractuel des prestations en cours. Il ne compte pas dans le "
                "chiffre d'affaires tant qu'il n'est pas facturé PUIS encaissé : c'est un "
                "repère de charge de travail, pas une recette."
            ),
        ))

    if pieces.cadeaux:
        alertes.append(Alerte(
            niveau="vigilance",
            titre=f"{_eur(pieces.total_cadeaux_eur)} d'avantages en nature comptés dans le CA",
            message=(
                f"{len(pieces.cadeaux)} cadeau(x) reçu(s) en contrepartie d'un service. "
                "Fiscalement ce ne sont pas des cadeaux : un partenariat rémunéré en produits "
                "est un revenu en nature, déclarable à sa valeur marchande. Ces montants "
                "n'apparaissent sur AUCUN relevé bancaire — vérifiez chaque valeur retenue."
            ),
        ))

    if pieces.cadeaux_a_valoriser:
        alertes.append(Alerte(
            niveau="critique",
            titre=f"{len(pieces.cadeaux_a_valoriser)} cadeau(x) sans valeur retenue",
            message=(
                "Ces avantages en nature ne sont PAS comptés faute de valeur marchande, ce qui "
                "minore votre chiffre d'affaires déclaré. Renseignez leur valeur dans vos "
                "justificatifs avant de déclarer."
            ),
        ))

    if pieces.depenses:
        alertes.append(Alerte(
            niveau="info",
            titre=f"{_eur(pieces.total_depenses_eur)} de dépenses capturées",
            message=(
                "En micro-entreprise, l'abattement forfaitaire remplace la déduction des "
                "frais réels : ces dépenses ne réduisent pas votre impôt. Elles servent à "
                "mesurer votre marge réelle, et à juger si le régime micro reste avantageux."
            ),
        ))

    return alertes


def _ca_facture_sur_la_periode(factures: List[Dict[str, Any]], debut: date, fin: date) -> float:
    """CA facturé HT sur la période — INDICATEUR, jamais assiette.

    Sert à montrer l'écart avec l'encaissé : une facture émise en fin de période et payée le
    mois suivant creuse cet écart sans qu'il y ait d'anomalie.
    """
    return round(sum(
        float(f.get("total_ht") or 0) for f in factures
        if f.get("date_emission") and debut.isoformat() <= f["date_emission"] <= fin.isoformat()
    ), 2)


def generer(uid: str, demande: DemandeRapport, profil: UserProfile | None = None) -> RapportFiscal:
    """Produit LE rapport fiscal de la période demandée.

    Un seul rapport, une seule assiette : le **CA encaissé**. Le CA facturé y figure comme
    indicateur, à côté, pour éclairer l'écart — pas comme un second résultat concurrent.

    `profil` sert à tracer que le rapport s'appuie sur un profil déclaré ; le contexte de
    calcul, lui, vient de `demande.contexte`, que l'utilisateur a pu corriger à l'écran.
    """
    debut = date.fromisoformat(demande.date_debut)
    fin = date.fromisoformat(demande.date_fin)
    contexte = demande.contexte

    factures = _factures_avec_existence_fiscale(uid)
    tous_virements = _virements(uid)

    resultat_rappro = rappro.rapprocher(factures, tous_virements, debut, fin)
    ca_bancaire = resultat_rappro.ca_encaisse
    ca_par_categorie = dict(resultat_rappro.ca_par_categorie)

    # -- Avantages en nature : du chiffre d'affaires sans flux bancaire ------------------
    # Un partenariat rémunéré en produits est un revenu en nature. Il ne passe PAS par le
    # rapprochement — il n'y a aucun virement à rapprocher — mais il entre dans l'assiette.
    cadeaux = sources.cadeaux_recus(uid, debut, fin)
    a_valoriser = sources.cadeaux_sans_valeur(uid, debut, fin)
    ca_cadeaux = sources.total_cadeaux(cadeaux)

    if ca_cadeaux > 0:
        # Un cadeau rémunère un SERVICE rendu : il relève de la prestation, jamais de la
        # vente de marchandises — le créateur ne vend pas l'objet, il l'a reçu.
        ca_par_categorie["prestation"] = round(
            ca_par_categorie.get("prestation", 0.0) + ca_cadeaux, 2
        )

    ca_retenu = round(ca_bancaire + ca_cadeaux, 2)
    base = (
        "CA ENCAISSÉ : les virements reçus, rapprochés d'une facture et datés de la période, "
        "AUXQUELS S'AJOUTENT les avantages en nature reçus en contrepartie d'un service, "
        "retenus à leur valeur marchande. Une facture non payée ne compte pas — elle comptera "
        "lors de son encaissement."
        if ca_cadeaux > 0 else
        "CA ENCAISSÉ : seuls les virements reçus, rapprochés d'une facture et datés de la "
        "période, sont comptés. Une facture non payée ne compte pas — elle comptera lors de "
        "son encaissement."
    )

    # -- Pièces de contexte : elles éclairent, elles n'entrent pas dans l'assiette --------
    contrats = sources.contrats_en_cours(uid, debut, fin)
    depenses = sources.depenses_capturees(uid, debut, fin)
    # Un salaire n'est pas du revenu d'activité engagé : l'additionner aux contrats
    # commerciaux mélangerait deux natures de revenu qui ne se déclarent pas au même endroit.
    salariat = sources.contrats_de_salariat(contrats)
    commerciaux = [c for c in contrats if c not in salariat]
    pieces = SourcesRapport(
        factures_emises=len(factures),
        virements_analyses=len(tous_virements),
        contrats_en_cours=len(contrats),
        depenses_capturees=len(depenses),
        cadeaux_recus=len(cadeaux),
        profil_onboarding=profil is not None,
        contrats=contrats,
        depenses=depenses,
        cadeaux=[CadeauRecu(**c) for c in cadeaux],
        cadeaux_a_valoriser=a_valoriser,
        total_depenses_eur=sources.total_eur(depenses),
        total_cadeaux_eur=ca_cadeaux,
        revenu_contractuel_engage_eur=sources.total_eur(commerciaux),
    )

    # Une période couvrant l'année civile entière permet seule de conclure sur les seuils
    # de TVA, qui s'apprécient sur l'année.
    annee_complete = (
        debut.month == 1 and debut.day == 1 and fin.month == 12 and fin.day == 31
        and debut.year == fin.year
    )
    etat_tva = tva_flag.statut_franchise(ca_par_categorie)
    etat_tva["periode_annee_complete"] = annee_complete

    activites = _activites(ca_par_categorie, contexte)

    # Le moteur d'impôt fait foi : on lui passe le payload, on recopie sa réponse. Il est
    # appelé MÊME à CA nul — les montants valent alors zéro, ce qui est un résultat.
    simulation: Dict[str, Any] = moteur.simuler_impots(
        activites=activites,
        parts_fiscales=contexte.parts_fiscales,
        autres_revenus=contexte.autres_revenus,
        en_couple=contexte.en_couple,
        rfr_n2=contexte.rfr_n2,
        caisse_bnc=contexte.caisse_bnc,
        acre_active=contexte.acre_active,
        option_versement_liberatoire=contexte.option_versement_liberatoire,
        jours_activite=contexte.jours_activite,
    )

    # Contrôle du plafond et constantes appliquées : eux aussi viennent du moteur.
    controle_plafonds = moteur.verifier_plafonds(activites, contexte.jours_activite)
    parametres = [
        moteur.parametres_categorie(
            a["categorie"], caisse_bnc=contexte.caisse_bnc,
            jours_activite=contexte.jours_activite,
        )
        for a in activites
    ]
    etat_acre = acre_flag.statut(
        contexte.acre_active,
        date_debut=getattr(profil, "acre_start_date", None) if profil else None,
        a_la_date=fin,
    )
    etat_prorata = _prorata(contexte, profil, controle_plafonds)

    hypotheses = [base]
    if ca_retenu <= 0:
        hypotheses.append(
            "Aucun chiffre d'affaires encaissé sur la période. Les calculs fiscaux ont bien "
            "été effectués avec un chiffre d'affaires nul : abattement, base imposable, "
            "cotisations sociales, CFP, impôt imputable et total des prélèvements valent donc "
            "0 €. La déclaration reste obligatoire même à zéro."
        )
    if depenses:
        hypotheses.append(
            "Les dépenses capturées sont affichées à titre indicatif : en micro-entreprise, "
            "l'abattement forfaitaire remplace la déduction des frais réels. Elles ne "
            "réduisent ni la base imposable, ni l'assiette sociale."
        )
    if contrats:
        hypotheses.append(
            "Les contrats en cours ne comptent pas dans le chiffre d'affaires : un contrat "
            "signé engage, il n'encaisse pas. Ils comptent au fil de leurs encaissements."
        )
    if simulation:
        hypotheses.extend(simulation.get("avertissements") or [])

    return RapportFiscal(
        id=uuid.uuid4().hex,
        uid=uid,
        date_debut=demande.date_debut,
        date_fin=demande.date_fin,
        genere_le=datetime.now(timezone.utc).isoformat(),
        ca_retenu=ca_retenu,
        ca_encaisse_bancaire=ca_bancaire,
        ca_avantages_en_nature=ca_cadeaux,
        base_de_calcul=base,
        ca_facture_periode=_ca_facture_sur_la_periode(factures, debut, fin),
        rapprochement=resultat_rappro,
        sources=pieces,
        simulation=simulation,
        ir_calculable=bool(simulation.get("ir_bareme_calculable")),
        tva=etat_tva,
        categories_fiscales=[a["categorie"] for a in activites],
        plafonds=controle_plafonds,
        parametres=parametres,
        acre=etat_acre,
        prorata=etat_prorata,
        alertes=(
            _alertes(resultat_rappro, simulation, contexte)
            + _alerte_acre(etat_acre)
            + _alertes_pieces(pieces)
            + tva_flag.alertes_tva(ca_par_categorie, annee_complete)
        ),
        hypotheses=hypotheses,
        provenance=(simulation or {}).get("provenance") or moteur.constantes_fiscales()["provenance"],
    )
