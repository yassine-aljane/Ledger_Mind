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
