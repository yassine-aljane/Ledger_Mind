"""Critical deterministic roadmap tests (ported from diagnostic agent)."""

from __future__ import annotations

from app.agents.guidance.roadmap.parcours import (
    PARCOURS_BASCULE,
    PARCOURS_MICRO,
    PARCOURS_SOCIETE,
    RoadmapIncoherente,
    build_roadmap,
    valider_coherence,
)


def _ids(roadmap):
    return {e["id"] for e in roadmap["etapes"]}


def _parcours_des_etapes(roadmap):
    return {e["parcours"] for e in roadmap["etapes"]}


def test_ca_20000_micro():
    r = build_roadmap({"activite": "YouTube", "ca_estime_annuel": 20000})
    assert r["parcours"] == PARCOURS_MICRO
    assert r["bandeau"]["type"] == PARCOURS_MICRO
    assert _parcours_des_etapes(r) == {PARCOURS_MICRO}
    assert "choix_forme" not in _ids(r)


def test_ca_85000_bascule_pas_societe():
    r = build_roadmap({"activite": "Instagram", "ca_estime_annuel": 85000})
    assert r["parcours"] == PARCOURS_BASCULE
    assert r["bandeau"]["type"] == PARCOURS_BASCULE
    assert r["comparatif"] is not None
    assert len(_parcours_des_etapes(r)) == 1
    assert "arbitrer" in r["bandeau"]["texte"].lower()


def test_ca_82000_bascule_ou_micro_sans_contradiction():
    r = build_roadmap({"activite": "TikTok", "ca_estime_annuel": 82000})
    assert r["parcours"] in (PARCOURS_MICRO, PARCOURS_BASCULE)
    valider_coherence(r)


def test_ca_85000_vend_produits_mixte():
    r = build_roadmap(
        {"activite": "YouTube + merch", "ca_estime_annuel": 85000, "vend_produits": True}
    )
    assert r["categorie"] == "mixte"
    assert r["mixte"] is not None
    assert "BIC" in r["mixte"]["texte"] and "BNC" in r["mixte"]["texte"]
    assert "83 600" in r["mixte"]["texte"] and "203 100" in r["mixte"]["texte"]


def test_ca_0_micro_rassurant():
    r = build_roadmap({"activite": "débute sur Instagram", "ca_estime_annuel": 0})
    assert r["parcours"] == PARCOURS_MICRO
    assert "adaptée" in r["bandeau"]["texte"].lower()


def test_ca_eleve_societe():
    r = build_roadmap({"activite": "gros compte", "ca_estime_annuel": 250000})
    assert r["parcours"] == PARCOURS_SOCIETE
    assert _parcours_des_etapes(r) == {PARCOURS_SOCIETE}
    assert "urssaf" not in _ids(r)


def test_bascule_recomposition_societe():
    r = build_roadmap(
        {"activite": "Instagram", "ca_estime_annuel": 85000, "choix_parcours": "societe"}
    )
    assert r["parcours"] == PARCOURS_BASCULE
    assert r["etapes_parcours"] == PARCOURS_SOCIETE
    assert _parcours_des_etapes(r) == {PARCOURS_SOCIETE}
    valider_coherence(r)


def test_garde_fou_detecte_incoherence():
    r = build_roadmap({"activite": "YouTube", "ca_estime_annuel": 20000})
    r["bandeau"]["type"] = PARCOURS_SOCIETE
    try:
        valider_coherence(r)
    except RoadmapIncoherente:
        pass
    else:
        raise AssertionError("Le garde-fou aurait dû détecter l'incohérence bandeau/parcours.")


def test_vente_pure_bic_seuil_203100():
    r = build_roadmap(
        {"activite": "boutique en ligne", "ca_estime_annuel": 120000, "type_activite": "vente"}
    )
    assert r["categorie"] == "bic_vente"
    assert r["parcours"] == PARCOURS_MICRO


def test_durabilite_depassement_durable_force_societe():
    r = build_roadmap({"ca_estime_annuel": 90000, "ca_n_1_au_dessus_seuil": True})
    assert r["durabilite"] == "depassement_durable"
    assert r["parcours"] == PARCOURS_SOCIETE
    assert _parcours_des_etapes(r) == {PARCOURS_SOCIETE}


def test_durabilite_indeterminee_sans_historique():
    r = build_roadmap({"ca_estime_annuel": 90000})
    assert r["durabilite"] == "indetermine"
    assert r["parcours"] != PARCOURS_SOCIETE


def test_aucun_seuil_en_dur_valeurs_2026():
    # Les valeurs proviennent bien du YAML (2026).
    r = build_roadmap({"activite": "Instagram", "ca_estime_annuel": 85000})
    assert r["meta"]["annee"] == 2026
    # Le seuil TVA services (37 500) doit apparaître dans l'étape TVA... via le comparatif ici.
    txt = " ".join(l[1] + l[2] for l in r["comparatif"]["lignes"])
    assert "37 500" in txt

def test_vente_pure_bascule_pres_du_seuil():
    r = build_roadmap({"ca_estime_annuel": 210000, "type_activite": "vente"})
    # 210 000 / 203 100 ≈ 1,03 -> zone de bascule.
    assert r["parcours"] == PARCOURS_BASCULE
    valider_coherence(r)

def test_prorata_premiere_annee_reduit_le_seuil():
    # 70 000 € annualisé serait micro (< 83 600) ; mais début au jour 306 -> seuil ~70 087,
    # donc on est en zone de bascule, pas confortablement micro.
    plein = build_roadmap({"ca_estime_annuel": 70000})
    assert plein["parcours"] == PARCOURS_MICRO
    proratise = build_roadmap({"ca_estime_annuel": 70000, "premiere_annee": True,
                               "jours_activite": 306})
    assert proratise["prorata"] is not None
    assert proratise["prorata"]["seuil_ajuste"] == round(83600 * 306 / 365)
    # Le seuil effectif est réduit -> le ratio grimpe -> bascule.
    assert proratise["parcours"] == PARCOURS_BASCULE
    assert "proratisé" in proratise["bandeau"]["texte"].lower()

def test_prorata_via_anciennete_texte():
    r = build_roadmap({"ca_estime_annuel": 70000, "anciennete": "moins d'un an",
                       "jours_activite": 200})
    assert r["prorata"] is not None
    assert r["prorata"]["jours"] == 200

def test_durabilite_ponctuelle_si_n1_sous_seuil():
    r = build_roadmap({"ca_estime_annuel": 90000, "ca_n_1_au_dessus_seuil": False})
    assert r["durabilite"] == "depassement_ponctuel"

def test_ca_eleve_sans_historique_reste_indetermine():
    # Même à 250 000 €, une seule année ne déchoit pas : la durabilité reste indéterminée
    # tant que l'historique N-1 n'est pas connu (correction juridique de fond).
    r = build_roadmap({"ca_estime_annuel": 250000})
    assert r["parcours"] == PARCOURS_SOCIETE  # bande d'affichage
    assert r["durabilite"] == "indetermine"   # droit strict

def test_legal_sources_enrichies_metadonnees_completes():
    r = build_roadmap({"ca_estime_annuel": 85000})
    ls = r["legal_sources"]
    # Toutes les sources mobilisées sont exposées (micro, TVA, franchissement, social, VL, compte).
    assert len(ls) >= 6
    for s in ls:
        assert s["label"] and s["source"].startswith("http")
        assert s["annee"] == 2026 and s["date_verif"]

def test_scenarios_deterministes_sources():
    r = build_roadmap({"ca_estime_annuel": 90000})
    ids = {s["id"] for s in r["scenarios"]}
    assert {"rester_micro", "passer_societe"} <= ids
    micro = next(s for s in r["scenarios"] if s["id"] == "rester_micro")
    cot = next(m for m in micro["montants"] if "Cotisations" in m["label"])
    # Montant calculé depuis un taux sourcé : 90 000 × 25,6 % = 23 040 €.
    assert cot["valeur"] == "23 040 €"
    assert "25,6 %" in cot["base"] and cot["source"].startswith("http")
    # La société n'affiche AUCUN net/IS chiffré (hypothèses absentes du YAML).
    societe = next(s for s in r["scenarios"] if s["id"] == "passer_societe")
    assert societe["montants"] == []

def test_scenario_pas_de_benefice_mais_base_imposable():
    # Conséquence LÉGALE : on expose une « base imposable », jamais un « bénéfice » / « profit ».
    r = build_roadmap({"ca_estime_annuel": 90000})
    micro = next(s for s in r["scenarios"] if s["id"] == "rester_micro")
    labels = " ".join(m["label"].lower() for m in micro["montants"])
    assert "base imposable" in labels
    assert "bénéfice" not in labels and "benefice" not in labels and "profit" not in labels

def test_taux_social_cipav_lu_dans_le_yaml():
    # Cipav : le taux DOIT venir de micro_social.bnc_cipav (26,1 %), pas du régime général.
    r = build_roadmap({"ca_estime_annuel": 100000, "cipav": True})
    micro = next(s for s in r["scenarios"] if s["id"] == "rester_micro")
    cot = next(m for m in micro["montants"] if "Cotisations" in m["label"])
    assert "26,1 %" in cot["base"] and "Cipav" in cot["base"]
    assert cot["valeur"] == "26 100 €"  # 100 000 × 26,1 %

def test_taux_social_vente_lu_dans_le_yaml():
    r = build_roadmap({"ca_estime_annuel": 120000, "type_activite": "vente"})
    micro = next(s for s in r["scenarios"] if s["id"] == "rester_micro")
    cot = next(m for m in micro["montants"] if "Cotisations" in m["label"])
    assert "12,3 %" in cot["base"]  # micro_social.vente

def test_projection_statut_tva_et_marges():
    r = build_roadmap({"ca_estime_annuel": 40000})  # > 37 500 base services, < 41 250 majoré
    proj = r["projections"]
    assert proj["statut_tva"]["statut"] == "redevable_base"
    labels = {m["label"] for m in proj["marges"]}
    assert {"Plafond micro", "Franchise TVA (base)", "Franchise TVA (majoré)"} <= labels
    # La marge avant le plafond micro est bien seuil - CA.
    micro_marge = next(m for m in proj["marges"] if m["label"] == "Plafond micro")
    assert micro_marge["marge"] == 83600 - 40000

def test_projection_sortie_micro_durable_annee():
    r = build_roadmap({"ca_estime_annuel": 90000, "ca_n_1_au_dessus_seuil": True})
    sortie = r["projections"]["sortie_micro"]
    assert sortie["exclusion"] is True
    assert sortie["annee_estimee"] == r["meta"]["annee"] + 1

def test_projection_sortie_micro_par_croissance():
    # CA sous le plafond mais croissance 30 %/an -> franchissement puis sortie datés.
    r = build_roadmap({"ca_estime_annuel": 70000, "taux_croissance": 0.30})
    sortie = r["projections"]["sortie_micro"]
    assert sortie["exclusion"] is False
    assert sortie["annee_estimee"] is not None and sortie["annee_estimee"] > r["meta"]["annee"]
