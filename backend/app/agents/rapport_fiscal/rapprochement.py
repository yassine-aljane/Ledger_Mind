"""Rapprochement facture ↔ virement — le CA imposable est l'ENCAISSÉ, pas le facturé.

Une facture émise et non payée ne compte pas pour la période : elle comptera pour celle où le
virement arrive. Ce module retrouve donc, pour chaque encaissement, la facture qu'il solde.

Deux stratégies, dans cet ordre :

  1. **Numéro de facture** trouvé dans le motif ou la référence du virement → rattachement
     CERTAIN. C'est précisément pourquoi le PDF de facture rappelle au client d'indiquer la
     référence dans le libellé de son virement.
  2. **Montant et fenêtre de dates** concordants → rattachement À CONFIRMER, jamais appliqué
     en silence : deux factures de même montant sont indiscernables par ce seul critère.

Rien n'est deviné. Un virement non rattaché, un sens douteux, un écart de montant : tout
ressort dans une liste dédiée avec son motif, pour que l'utilisateur tranche.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

from .schemas import (
    EcartRapprochement,
    FactureNonSoldee,
    LigneEncaissement,
    Rapprochement,
    VirementNonRetenu,
)

# Tolérance d'écart entre le montant viré et le net à payer. Deux centimes absorbent les
# arrondis ; au-delà, l'écart est signalé plutôt qu'absorbé.
TOLERANCE_MONTANT = 0.02

# Fenêtre acceptée entre l'émission d'une facture et l'encaissement, pour un rattachement
# par montant. Au-delà, la coïncidence de montant ne suffit plus à conclure.
FENETRE_JOURS = 120

# Format de numéro produit par l'agent de facturation (voir data/facturation.yaml).
_MOTIF_NUMERO = re.compile(r"\b((?:FA|AV)[-\s]?\d{4}[-\s]?\d{4,6})\b", re.IGNORECASE)


def _normaliser_numero(brut: str) -> str:
    return re.sub(r"[\s]", "-", brut.strip().upper()).replace("--", "-")


def numeros_factures_cites(*textes: Optional[str]) -> List[str]:
    """Numéros de facture repérés dans le libellé ou la référence d'un virement."""
    trouves: List[str] = []
    for texte in textes:
        if not texte:
            continue
        for brut in _MOTIF_NUMERO.findall(texte):
            numero = _normaliser_numero(brut)
            if numero not in trouves:
                trouves.append(numero)
    return trouves


def _date(valeur: Any) -> Optional[date]:
    if not valeur:
        return None
    try:
        return date.fromisoformat(str(valeur)[:10])
    except ValueError:
        return None


def _dans_periode(valeur: Any, debut: date, fin: date) -> bool:
    d = _date(valeur)
    return d is not None and debut <= d <= fin


def part_hors_taxe(facture: Dict[str, Any], encaisse: float) -> float:
    """Convertit un encaissement (payé TTC) en chiffre d'affaires HORS TAXE.

    Le client règle un montant TTC, mais l'assiette du micro-fiscal et du micro-social est le
    chiffre d'affaires HT : la TVA collectée n'a jamais été un revenu, elle transite. En
    franchise en base les deux montants coïncident, ce qui masque complètement l'erreur — d'où
    cette conversion explicite plutôt qu'un raccourci.

    Le rapport de conversion est celui de la facture elle-même : aucun taux n'est supposé ici.
    """
    ttc = float(facture.get("total_ttc") or 0)
    ht = float(facture.get("total_ht") or 0)
    if ttc <= 0 or abs(ttc - ht) <= 0.005:
        return round(encaisse, 2)  # franchise en base, ou facture sans total exploitable
    return round(encaisse * ht / ttc, 2)


def _categorie_facture(facture: Dict[str, Any]) -> str:
    """Nature dominante des lignes — sert à ventiler le CA en activité mixte."""
    ventes = sum(
        (l.get("quantite") or 0) * (l.get("prix_unitaire_ht") or 0)
        for l in facture.get("lignes") or []
        if l.get("categorie") == "vente"
    )
    autres = sum(
        (l.get("quantite") or 0) * (l.get("prix_unitaire_ht") or 0)
        for l in facture.get("lignes") or []
        if l.get("categorie") != "vente"
    )
    return "vente" if ventes > autres else "prestation"


def rapprocher(
    factures: Iterable[Dict[str, Any]],
    virements: Iterable[Dict[str, Any]],
    debut: date,
    fin: date,
) -> Rapprochement:
    """Rapproche les encaissements de la période avec les factures émises.

    `factures` : documents `factures_emises` ayant une existence fiscale (émise, partiellement
    payée, payée) — les brouillons et les annulées n'ont rien à solder.
    `virements` : documents de la collection `virements` de l'agent capture.

    Les factures ne sont PAS filtrées sur la période : un encaissement de janvier peut solder
    une facture de décembre. Seuls les VIREMENTS le sont.
    """
    factures = [f for f in factures if f.get("numero")]
    par_numero = {f["numero"]: f for f in factures}
    encaisse_par_facture: Dict[str, float] = {f["numero"]: 0.0 for f in factures}

    encaissements: List[LigneEncaissement] = []
    non_retenus: List[VirementNonRetenu] = []
    ecarts: List[EcartRapprochement] = []
    hors_periode: List[Dict[str, Any]] = []

    for v in virements:
        t = v.get("transfer") or {}
        doc_id = v.get("document_id", "")
        montant = float(t.get("amount") or 0)
        # La date qui rattache l'encaissement à une période est celle de l'OPÉRATION, pas la
        # date de valeur. Celle-ci est une convention bancaire de calcul d'intérêts, souvent
        # décalée d'un jour ou deux : la privilégier faisait sortir de la période un virement
        # exécuté le jour même, et il disparaissait sans un mot.
        date_operation = t.get("execution_date") or t.get("value_date")
        date_valeur = date_operation
        libelle = t.get("motif")
        reference = t.get("transfer_reference")
        contrepartie = t.get("sender_name") or t.get("beneficiary_name")
        # Sans `montant` : un virement groupé se répartit entre plusieurs factures, chaque
        # ligne portant sa propre part.
        commun = {
            "virement_document_id": doc_id,
            "date_valeur": date_valeur,
            "libelle": libelle,
            "contrepartie": contrepartie,
        }

        if not _dans_periode(date_valeur, debut, fin):
            # Hors période : jamais compté. Mais l'écarter SANS RIEN DIRE est un piège — un
            # utilisateur voyant « CA : 0 € » n'a aucun moyen de deviner que son virement se
            # trouve à un jour de la borne. On ne le compte pas, on le recense.
            hors_periode.append({
                "virement_document_id": doc_id,
                "date": date_valeur,
                "montant": round(montant, 2),
                "libelle": libelle,
                "cite_une_facture": bool(numeros_factures_cites(libelle, reference)),
            })
            continue

        if montant <= 0:
            non_retenus.append(VirementNonRetenu(
                **commun, montant=montant, motif="Montant nul ou négatif : rien à encaisser.",
            ))
            continue

        # Le sens de l'opération conditionne tout : un virement SORTANT gonflerait le CA
        # imposable. La lecture automatique se trompant, on ne retient que ce qui est
        # explicitement « reçu » et on soumet le reste à confirmation.
        sens = (t.get("direction") or "").strip().lower()
        if sens != "recu":
            non_retenus.append(VirementNonRetenu(
                **commun, montant=montant,
                motif=(
                    f"Sens de l'opération lu comme « {sens or 'indéterminé'} » : un virement "
                    "sortant ne fait pas partie du chiffre d'affaires."
                ),
                action_suggeree="Confirmez s'il s'agit bien d'un encaissement de client.",
            ))
            continue

        # 1) Numéro de facture cité : rattachement certain.
        cites = [n for n in numeros_factures_cites(libelle, reference) if n in par_numero]
        if cites:
            reste = montant
            for numero in cites:
                facture = par_numero[numero]
                du = float(facture.get("net_a_payer") or 0) - encaisse_par_facture[numero]
                # On n'affecte JAMAIS plus que le montant dû, même quand une seule facture
                # est citée : le surplus serait compté comme du chiffre d'affaires sans
                # justificatif, et l'anomalie passerait inaperçue.
                part = min(reste, max(du, 0.0))
                if part <= 0:
                    continue
                encaisse_par_facture[numero] += part
                reste -= part
                encaissements.append(LigneEncaissement(
                    **commun, montant=round(part, 2),
                    montant_ht=part_hors_taxe(facture, part),
                    facture_numero=numero, facture_id=facture.get("id"),
                    methode="numero_facture", certain=True,
                    categorie=_categorie_facture(facture),
                ))
            if reste > TOLERANCE_MONTANT:
                # Le virement dépasse ce que les factures citées réclamaient.
                ecarts.append(EcartRapprochement(
                    type="excedent",
                    message=(
                        f"Le virement dépasse de {reste:.2f} € le montant dû sur "
                        f"{', '.join(cites)}. Excédent non affecté."
                    ),
                    virement_document_id=doc_id, ecart=round(reste, 2),
                ))
            continue

        # 2) Montant et fenêtre de dates : candidat unique seulement.
        d_valeur = _date(date_valeur)
        candidats = []
        for f in factures:
            numero = f["numero"]
            du = float(f.get("net_a_payer") or 0) - encaisse_par_facture[numero]
            if du <= TOLERANCE_MONTANT or abs(du - montant) > TOLERANCE_MONTANT:
                continue
            d_emission = _date(f.get("date_emission"))
            if d_emission and d_valeur and not (
                d_emission - timedelta(days=1) <= d_valeur <= d_emission + timedelta(days=FENETRE_JOURS)
            ):
                continue
            candidats.append(f)

        if len(candidats) == 1:
            facture = candidats[0]
            encaisse_par_facture[facture["numero"]] += montant
            encaissements.append(LigneEncaissement(
                **commun, montant=montant,
                montant_ht=part_hors_taxe(facture, montant),
                facture_numero=facture["numero"], facture_id=facture.get("id"),
                methode="montant_date", certain=False,
                categorie=_categorie_facture(facture),
            ))
        elif len(candidats) > 1:
            non_retenus.append(VirementNonRetenu(
                **commun, montant=montant,
                motif=(
                    f"{len(candidats)} factures du même montant : impossible de trancher sans "
                    "référence."
                ),
                action_suggeree="Rattachez ce virement à la main, ou demandez au client "
                                "d'indiquer le n° de facture dans le libellé.",
            ))
        else:
            non_retenus.append(VirementNonRetenu(
                **commun, montant=montant,
                motif="Aucune facture correspondante : encaissement sans facture émise.",
                action_suggeree="Vérifiez qu'une facture a bien été établie pour cette recette.",
            ))

    # -- Suivi des factures ----------------------------------------------------
    impayees: List[FactureNonSoldee] = []
    partielles: List[FactureNonSoldee] = []
    aujourdhui = date.today()
    for f in factures:
        numero = f["numero"]
        du = float(f.get("net_a_payer") or 0)
        encaisse = round(encaisse_par_facture[numero], 2)
        if du <= 0:
            continue  # avoir : rien à encaisser
        reste = round(du - encaisse, 2)
        if reste <= TOLERANCE_MONTANT:
            continue

        echeance = _date(f.get("date_echeance"))
        retard = bool(echeance and echeance < aujourdhui)
        ligne = FactureNonSoldee(
            numero=numero, facture_id=f.get("id"),
            client=(f.get("client") or {}).get("nom"),
            date_emission=f.get("date_emission"), date_echeance=f.get("date_echeance"),
            net_a_payer=du, encaisse=encaisse, reste_du=reste,
            en_retard=retard,
            jours_de_retard=(aujourdhui - echeance).days if retard and echeance else None,
        )
        (partielles if encaisse > 0 else impayees).append(ligne)

    # Le CA est la somme des parts HORS TAXE : la TVA collectée n'entre ni dans l'assiette
    # fiscale ni dans l'assiette sociale.
    ca = round(sum(e.montant_ht for e in encaissements), 2)
    ca_certain = round(sum(e.montant_ht for e in encaissements if e.certain), 2)

    par_categorie: Dict[str, float] = {}
    for e in encaissements:
        par_categorie[e.categorie] = round(par_categorie.get(e.categorie, 0.0) + e.montant_ht, 2)

    return Rapprochement(
        periode_debut=debut.isoformat(),
        periode_fin=fin.isoformat(),
        ca_encaisse=ca,
        ca_encaisse_certain=ca_certain,
        encaissements=encaissements,
        virements_non_retenus=non_retenus,
        factures_impayees=impayees,
        factures_partielles=partielles,
        ecarts=ecarts,
        ca_par_categorie=par_categorie,
        virements_hors_periode=sorted(hors_periode, key=lambda h: h["date"] or ""),
    )
