"""Moteur JURIDIQUE PUR — analyse de conformité au droit strict (France 2026).

Ce module ne connaît NI l'UX, NI les bandes d'affichage, NI les boutons de l'interface.
Il répond à une seule question : « au regard du droit, ce profil est-il éligible au régime
micro, dans quelle catégorie, et ce statut est-il DURABLE ? »

Deux corrections de fond par rapport à l'ancienne logique :
  1. La DURABILITÉ (dépassement ponctuel vs durable) est déterminée par l'HISTORIQUE réel
     N-1/N-2 transmis par le profil — et non plus déduite de la bande d'affichage. Un CA
     élevé une seule année n'exclut JAMAIS du micro : la sortie n'intervient qu'après deux
     années consécutives de dépassement (règle des 2 ans, cf. seuils.yaml/franchissement).
  2. Aucune valeur métier n'est codée en dur ni en repli : tout vient de seuils.yaml. Si un
     bloc manque, l'erreur remonte (jamais une valeur inventée silencieusement).

Toutes les valeurs proviennent de data/seuils.yaml via app.roadmap.seuils.
"""
from __future__ import annotations

from app.roadmap import seuils as S
from app.roadmap.models import AnalyseJuridique, CaRetenu, LegalSource, Prorata

# --- Durabilité du régime micro pour ce profil (droit strict) ----------------
DURABILITE_STABLE = "eligible_stable"
DURABILITE_PONCTUEL = "depassement_ponctuel"
DURABILITE_DURABLE = "depassement_durable"
DURABILITE_INDET = "indetermine"

# --- Catégorie fiscale : dépend de la NATURE de l'activité, jamais du statut --
_TYPE_VERS_CATEGORIE = {
    "prestation": "bnc",       # création de contenu / influence = prestation de promotion => BNC
    "bnc": "bnc",
    "vente": "bic_vente",      # pure vente de biens => BIC vente (seuil 203 100 €)
    "bic_vente": "bic_vente",
    "mixte": "mixte",
}


def categorie_activite(profil: dict) -> str:
    """Catégorie fiscale à partir de la NATURE de l'activité (champ explicite prioritaire)."""
    explicite = (profil.get("type_activite") or "").strip().lower()
    if explicite in _TYPE_VERS_CATEGORIE:
        return _TYPE_VERS_CATEGORIE[explicite]
    return "mixte" if bool(profil.get("vend_produits")) else "bnc"


def seuil_micro_reference(categorie: str) -> tuple[int, str]:
    """(seuil micro pivot, url source) pour la catégorie. 'mixte' -> seuil services (limitant)."""
    micro = S.bloc("micro")
    if categorie == "bic_vente":
        return int(micro["bic_vente"]["seuil"]), micro["bic_vente"]["source"]
    if categorie == "mixte":
        return int(micro["mixte"]["seuil_services"]), micro["mixte"]["source"]
    return int(micro["bnc"]["seuil"]), micro["bnc"]["source"]


# ---------------------------------------------------------------------------
#  Chiffre d'affaires retenu (nettoyage des entrées, ventilation BIC/BNC)
# ---------------------------------------------------------------------------
def _f(x) -> float:
    """Convertit prudemment une valeur (None/'' -> 0.0)."""
    try:
        return float(x) if x is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def extraire_ca_retenu(profil: dict) -> CaRetenu:
    """Isole le CA retenu par catégorie. Si seul le CA global est fourni, il est affecté
    à la catégorie déclarée (prestation -> BNC, vente -> BIC vente)."""
    ca_p = _f(profil.get("ca_prestations"))
    ca_v = _f(profil.get("ca_vente"))
    ca_global = _f(profil.get("ca_estime_annuel"))
    if ca_global <= 0:
        ca_global = ca_p + ca_v

    # Global fourni seul, sans ventilation : on l'affecte selon la catégorie déclarée.
    if ca_global > 0 and (ca_p + ca_v) == 0:
        type_act = (profil.get("type_activite") or "").strip().lower()
        if type_act in {"prestation", "bnc"}:
            ca_p = ca_global
        elif type_act in {"vente", "bic_vente"}:
            ca_v = ca_global

    ventile = ca_p + ca_v
    return CaRetenu(
        ca_prestations=ca_p,
        ca_vente=ca_v,
        ca_global=ventile if ventile > 0 else ca_global,
    )


# ---------------------------------------------------------------------------
#  Prorata temporis (1re année incomplète)
# ---------------------------------------------------------------------------
_ANCIENNETE_PREMIERE = {
    "premiere annee", "première année", "1re annee", "1re année",
    "moins d'un an", "<1 an", "< 1 an", "0",
}


def calculer_prorata(profil: dict, seuil_plein: int) -> Prorata:
    """Applique le prorata temporis la 1re année et documente le motif (aucune valeur devinée)."""
    pt = S.bloc("prorata_temporis")
    anciennete = str(profil.get("anciennete") or "").strip().lower()
    est_premiere = bool(profil.get("premiere_annee")) or anciennete in _ANCIENNETE_PREMIERE
    jours = profil.get("jours_activite")

    if not est_premiere:
        return Prorata(applique=False, seuil_plein=seuil_plein, source=pt["source"],
                       raison="Activité non signalée comme première année : seuil plein applicable.")
    if not isinstance(jours, (int, float)) or not (0 < jours < 365):
        return Prorata(applique=False, seuil_plein=seuil_plein, source=pt["source"],
                       raison="Première année signalée mais nombre de jours d'existence absent ou invalide.")

    seuil_ajuste = round(seuil_plein * jours / 365)
    return Prorata(
        applique=True, jours=int(jours), seuil_plein=seuil_plein, seuil_ajuste=seuil_ajuste,
        formule=pt["formule"], source=pt["source"],
        raison=f"Première année incomplète : seuil calculé sur {int(jours)} jours d'existence.",
    )


# ---------------------------------------------------------------------------
#  Durabilité — RÈGLE LÉGALE DES 2 ANS (droit strict, historique N-1/N-2)
# ---------------------------------------------------------------------------
def _historique_connu(profil: dict) -> bool:
    return profil.get("ca_n_1_au_dessus_seuil") is not None


def _durabilite(depassement: bool, profil: dict, forcee: str | None) -> tuple[str, str]:
    """Renvoie (durabilite, motif). `forcee` = INDET si la ventilation mixte manque."""
    if forcee:
        return forcee, ("Dépassement possible mais indéterminé : la ventilation "
                        "prestations / vente est nécessaire pour trancher.")
    if not depassement:
        return DURABILITE_STABLE, "Chiffre d'affaires inférieur aux plafonds micro : éligibilité de plein droit."
    if not _historique_connu(profil):
        return DURABILITE_INDET, ("Dépassement constaté cette année ; durabilité indéterminée faute "
                                  "d'historique (le CA de l'an dernier était-il déjà au-dessus du plafond ?).")
    if bool(profil.get("ca_n_1_au_dessus_seuil")):
        fr = S.bloc("franchissement")
        return DURABILITE_DURABLE, ("Deuxième année consécutive de dépassement : sortie automatique du "
                                    f"régime micro ({fr['effet']}).")
    return DURABILITE_PONCTUEL, ("Dépassement cette année seulement (année précédente sous le plafond) : "
                                 "statut micro préservé au titre de la tolérance de franchissement.")


# ---------------------------------------------------------------------------
#  Analyse juridique complète
# ---------------------------------------------------------------------------
def analyser(profil: dict) -> AnalyseJuridique:
    """Analyse juridique pure : catégorie, seuils, ratio légal, marges, durabilité."""
    ca_data = extraire_ca_retenu(profil)
    categorie = categorie_activite(profil)
    seuil_plein, source_legale = seuil_micro_reference(categorie)
    prorata = calculer_prorata(profil, seuil_plein)
    seuil_effectif = prorata.seuil_ajuste if prorata.applique else seuil_plein

    micro = S.bloc("micro")
    tva = S.bloc("tva_franchise")
    motifs: list[str] = []
    durabilite_forcee: str | None = None

    if categorie == "mixte":
        m = micro["mixte"]
        seuil_glob = int(m["seuil_global"])
        ca_p, ca_v = ca_data.ca_prestations, ca_data.ca_vente
        if (ca_p + ca_v) > 0 and (ca_p > 0 and ca_v > 0):
            r_serv = ca_p / seuil_effectif if seuil_effectif else 0.0
            r_glob = (ca_p + ca_v) / seuil_glob if seuil_glob else 0.0
            ratio = max(r_serv, r_glob)
            marge_micro = min(seuil_effectif - ca_p, seuil_glob - ca_data.ca_global)
        else:
            # Ventilation manquante : décision prudente sur le CA global, durabilité indéterminée
            # dès que le global pourrait franchir le sous-plafond services.
            ratio = (ca_data.ca_global / seuil_glob) if seuil_glob else 0.0
            marge_micro = seuil_glob - ca_data.ca_global
            if ca_data.ca_global > seuil_effectif:
                durabilite_forcee = DURABILITE_INDET
        motifs.append(f"Activité mixte : plafond services {seuil_effectif:,} € ET plafond global "
                      f"{seuil_glob:,} €.".replace(",", " "))
    else:
        ratio = (ca_data.ca_global / seuil_effectif) if seuil_effectif else 0.0
        marge_micro = seuil_effectif - ca_data.ca_global
        motifs.append(f"Activité mono-catégorie {categorie.upper()} : plafond de référence "
                      f"{seuil_effectif:,} €.".replace(",", " "))

    # Marge de franchise TVA (saute AVANT le plafond micro).
    tva_cat = "vente" if categorie == "bic_vente" else "services"
    base_tva = ca_data.ca_prestations if categorie == "mixte" else ca_data.ca_global
    marge_tva = int(tva[tva_cat]["seuil_base"]) - base_tva

    depassement = ratio > 1.0
    durabilite, motif_dur = _durabilite(depassement, profil, durabilite_forcee)
    motifs.append(motif_dur)
    if prorata.applique:
        motifs.append(prorata.raison)

    return AnalyseJuridique(
        categorie=categorie,
        ca_retenu=ca_data,
        seuil_plein=seuil_plein,
        seuil_effectif=seuil_effectif,
        ratio_legal=round(ratio, 4),
        durabilite=durabilite,
        depassement_cette_annee=depassement,
        historique_connu=_historique_connu(profil),
        marge_micro_euros=round(marge_micro, 2),
        marge_micro_pourcent=round(ratio * 100, 1),
        marge_tva_euros=round(marge_tva, 2),
        prorata=prorata,
        motifs=motifs,
        source_legale=source_legale,
    )


# ---------------------------------------------------------------------------
#  Sources légales — enrichies avec TOUTES les métadonnées de seuils.yaml
# ---------------------------------------------------------------------------
def _src(bloc: dict, label: str, valeur) -> LegalSource:
    """Construit une source à partir d'un bloc YAML (échoue si une métadonnée manque)."""
    return LegalSource(label=label, valeur=valeur, annee=int(bloc["annee"]),
                       source=bloc["source"], date_verif=bloc["date_verif"])


def legal_sources(analyse: AnalyseJuridique) -> list[LegalSource]:
    """Toutes les sources légales mobilisées par le verdict, chacune avec ses métadonnées
    complètes (valeur, année de validité, URL officielle, date de vérification)."""
    micro = S.bloc("micro")
    tva = S.bloc("tva_franchise")
    fr = S.bloc("franchissement")
    social = S.bloc("micro_social")
    vl = S.bloc("versement_liberatoire")
    cb = S.bloc("compte_bancaire_dedie")
    cat = analyse.categorie

    out: list[LegalSource] = []

    # 1. Plafond micro de la catégorie
    if cat == "bic_vente":
        out.append(_src(micro["bic_vente"], "Plafond micro-BIC vente", micro["bic_vente"]["seuil"]))
        tva_bloc, social_val, vl_val = tva["vente"], social["vente"], vl["vente"]
    elif cat == "mixte":
        m = micro["mixte"]
        out.append(_src(m, "Plafonds micro activité mixte (global / services)",
                        f"{m['seuil_global']} / {m['seuil_services']}"))
        tva_bloc, social_val, vl_val = tva["services"], social["bnc_regime_general"], vl["bnc"]
    else:
        out.append(_src(micro["bnc"], "Plafond micro-BNC", micro["bnc"]["seuil"]))
        tva_bloc, social_val, vl_val = tva["services"], social["bnc_regime_general"], vl["bnc"]

    # 2. Franchise en base de TVA (base / majoré)
    out.append(_src(tva_bloc, "Franchise en base de TVA (base / majoré)",
                    f"{tva_bloc['seuil_base']} / {tva_bloc['seuil_majore']}"))
    # 3. Règle de franchissement (2 années consécutives)
    out.append(_src(fr, "Règle de franchissement (années consécutives)", fr["annees_consecutives"]))
    # 4. Cotisations sociales (micro-social) applicables
    out.append(_src(social, "Taux de cotisations micro-social", social_val))
    # 5. Versement libératoire de l'IR (option)
    out.append(_src(vl, "Versement libératoire de l'IR (taux applicable)", vl_val))
    # 6. Compte bancaire dédié
    out.append(_src(cb, "Seuil d'obligation de compte bancaire dédié", cb["seuil"]))
    # 7. Prorata temporis (uniquement s'il a joué)
    if analyse.prorata.applique:
        pt = S.bloc("prorata_temporis")
        out.append(_src(pt, "Prorata temporis (1re année)", pt["formule"]))

    return out
