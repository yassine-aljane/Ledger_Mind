"""Questionnaire d'onboarding — cohérence entre la liste des questions et le modèle.

Ces tests existent à cause d'un bug réel : `FIELD_PRIORITY` a reçu 23 champs que `UserProfile`
ne portait pas. Le premier `getattr` levait `'UserProfile' object has no attribute
'fiscal_category'` — en plein parcours, au dépôt de l'avis SIRENE.

Trois invariants, chacun cassé par ce bug :

  1. tout champ demandé EXISTE sur le modèle — sinon `getattr` lève ;
  2. tout champ demandé est ACCEPTÉ par `apply_updates` — sinon la réponse est jetée en
     silence et la même question revient indéfiniment ;
  3. une réponse « je ne sais pas » fait AVANCER le parcours — sinon même boucle.
"""

from __future__ import annotations

import pytest

from app.agents.intake.questions import (
    _FALLBACK_QUESTIONS,
    _FIELD_DESCRIPTIONS,
    FIELD_PRIORITY,
    completeness_ratio,
    next_missing_field,
)
from app.agents.intake.tools.extract_answer import (
    _PROFILE_QUESTION_FIELDS,
    _nombre,
    apply_updates,
)
from app.schemas.orchestrator import UserProfile


# -- Invariant 1 : le modèle porte tout ce qu'on demande ---------------------
def test_tout_champ_demande_existe_sur_le_modele():
    """LE bug : un champ demandé mais absent du modèle fait planter tout l'onboarding."""
    absents = [f for f in FIELD_PRIORITY if f not in UserProfile.model_fields]
    assert absents == [], f"champs demandés mais absents de UserProfile : {absents}"


def test_aucun_doublon_dans_la_liste_des_questions():
    assert len(FIELD_PRIORITY) == len(set(FIELD_PRIORITY))


def test_chaque_champ_a_une_description():
    """Sans description, le prompt de génération de question part avec le nom technique."""
    sans = [f for f in FIELD_PRIORITY if f not in _FIELD_DESCRIPTIONS]
    assert sans == []


def test_chaque_champ_a_une_question_de_repli():
    """Le repli sert quand le LLM est indisponible — un champ sans repli produit une
    question générique illisible."""
    sans = [f for f in FIELD_PRIORITY if f not in _FALLBACK_QUESTIONS]
    assert sans == []


# -- Invariant 2 : les réponses sont bien enregistrées -----------------------
def test_tout_champ_demande_est_accepte_par_l_extracteur():
    """Un champ demandé mais absent de l'allowlist voit sa réponse jetée en silence,
    et la question revient à l'infini."""
    rejetes = [f for f in FIELD_PRIORITY if f not in _PROFILE_QUESTION_FIELDS]
    assert rejetes == [], f"réponses qui seraient ignorées : {rejetes}"


def test_apres_le_depot_de_l_avis_sirene_la_question_suivante_se_calcule():
    """Reproduction exacte du plantage signalé.

    Le dépôt de l'avis SIRENE fait passer `_advance_verification` à `_intake_ask`, qui appelle
    `ask_next_question` → `next_missing_field`. C'est là que le `getattr` levait
    `'UserProfile' object has no attribute 'fiscal_category'`, laissant l'utilisateur bloqué
    juste après avoir déposé son document.
    """
    apres_sirene = UserProfile(
        siren="812345678", siret="81234567800012", denomination="Studio Nova",
        verification_status="verified",
        sirene_document_uploaded=True,
        sirene_document_activity_label="Autres activités de soutien aux entreprises",
        sirene_document_address="14 rue des Lilas, 69003 Lyon",
        sirene_document_registration_date="2024-06-01",
    )
    assert next_missing_field(apres_sirene) is not None
    assert 0.0 <= completeness_ratio(apres_sirene) < 1.0


def test_le_parcours_ne_plante_sur_aucun_champ():
    """`next_missing_field` parcourt toute la liste : il doit tenir sur un profil vide."""
    assert next_missing_field(UserProfile()) is not None
    assert 0.0 <= completeness_ratio(UserProfile()) <= 1.0


def test_chaque_champ_peut_etre_renseigne_sans_planter():
    profil = UserProfile()
    for champ in FIELD_PRIORITY:
        profil = apply_updates(profil, {}, target_field=champ, last_answer="Oui")
    assert isinstance(profil, UserProfile)


# -- Normalisation des réponses fermées --------------------------------------
@pytest.mark.parametrize("reponse,attendu", [
    ("Vente de marchandises", "BIC_VENTE"),
    ("Prestation de service commerciale", "BIC_SERVICE"),
    ("Activité libérale (BNC)", "BNC"),
])
def test_la_categorie_fiscale_est_normalisee(reponse, attendu):
    """Le questionnaire compare à « BNC » : le libellé français doit être converti."""
    profil = apply_updates(UserProfile(), {}, target_field="fiscal_category",
                           last_answer=reponse)
    assert profil.fiscal_category == attendu


@pytest.mark.parametrize("reponse,attendu", [
    ("CIPAV", "CIPAV"),
    ("Régime général (SSI)", "REGIME_GENERAL"),
])
def test_la_caisse_est_normalisee(reponse, attendu):
    profil = apply_updates(UserProfile(), {}, target_field="bnc_caisse", last_answer=reponse)
    assert profil.bnc_caisse == attendu


@pytest.mark.parametrize("reponse,attendu", [
    ("Métropole", "metropole"),
    ("DOM", "dom"),
    ("J'exerce à la Réunion", "dom"),
])
def test_la_zone_est_normalisee(reponse, attendu):
    profil = apply_updates(UserProfile(), {}, target_field="location_zone", last_answer=reponse)
    assert profil.location_zone == attendu


def _parcourir(profil: UserProfile, reponse: str = "je ne sais pas") -> set[str]:
    """Déroule le questionnaire jusqu'au bout et renvoie les champs effectivement demandés.

    Borné : un questionnaire qui ne se termine pas est lui-même le défaut recherché, il doit
    faire échouer le test plutôt que le faire tourner indéfiniment.
    """
    demandes: set[str] = set()
    for _ in range(len(FIELD_PRIORITY) * 2):
        champ = next_missing_field(profil)
        if champ is None:
            return demandes
        demandes.add(champ)
        profil = apply_updates(profil, {}, target_field=champ, last_answer=reponse)
    pytest.fail("le questionnaire ne se termine pas")


def test_la_caisse_n_est_demandee_qu_en_bnc():
    """La question de la caisse de retraite n'a de sens que pour une activité libérale."""
    assert "bnc_caisse" in _parcourir(UserProfile(fiscal_category="BNC"))
    assert "bnc_caisse" not in _parcourir(UserProfile(fiscal_category="BIC_VENTE"))


def test_la_date_d_acre_n_est_demandee_que_si_l_acre_est_active():
    assert "acre_start_date" in _parcourir(UserProfile(acre_active=True))
    assert "acre_start_date" not in _parcourir(UserProfile(acre_active=False))


def test_la_declaration_manuelle_n_est_demandee_que_hors_virement_seul():
    """Encaisser uniquement par virement rend la saisie manuelle sans objet."""
    virement_seul = UserProfile(accepted_payment_methods=["Virement bancaire uniquement"])
    especes = UserProfile(accepted_payment_methods=["Virement bancaire uniquement", "Espèces"])

    assert "manual_income_declaration_mode" not in _parcourir(virement_seul)
    assert "manual_income_declaration_mode" in _parcourir(especes)


# -- Montants : un nombre, ou rien -------------------------------------------
@pytest.mark.parametrize("reponse,attendu", [
    ("1,5", 1.5),
    ("2", 2.0),
    ("20 000 €", 20000.0),
    ("Aucun autre revenu", 0.0),
])
def test_un_montant_explicite_est_lu(reponse, attendu):
    assert _nombre(reponse) == attendu


@pytest.mark.parametrize("reponse", [
    "Moins de 20 000 €",
    "20 000 € – 50 000 €",
    "Plus de 50 000 €",
    "2,5 ou plus",
    "je ne sais pas",
    "",
])
def test_une_fourchette_ne_devient_pas_une_valeur_ponctuelle(reponse):
    """L'inventer produirait un impôt faux sans le dire. Mieux vaut ne pas conclure."""
    assert _nombre(reponse) is None


def test_le_rfr_reste_vide_sur_une_fourchette():
    profil = apply_updates(UserProfile(), {}, target_field="rfr_n_minus_2",
                           last_answer="Moins de 20 000 €")
    assert profil.rfr_n_minus_2 is None


# -- Invariant 3 : « je ne sais pas » débloque le parcours -------------------
@pytest.mark.parametrize("reponse", [
    "Je ne sais pas",
    "je sais pas",
    # « aucune idée » contient « aucun » : lu comme « non » avant correction.
    "aucune idée",
    "Aucune idée, désolé",
])
def test_je_ne_sais_pas_est_consigne_et_ne_reboucle_pas(reponse):
    profil = apply_updates(UserProfile(), {}, target_field="acre_active", last_answer=reponse)

    assert profil.acre_active is None, "aucune valeur n'est inventée"
    assert "acre_active" in profil.unknown_fields
    assert not _demande_encore(profil, "acre_active")


def test_une_vraie_reponse_n_est_pas_consignee_comme_inconnue():
    profil = apply_updates(UserProfile(), {}, target_field="acre_active", last_answer="Oui")
    assert profil.acre_active is True
    assert profil.unknown_fields == []


def test_un_non_franc_reste_un_non():
    """La correction sur « aucune idée » ne doit pas avaler les vraies négations."""
    profil = apply_updates(UserProfile(), {}, target_field="acre_active", last_answer="Non")
    assert profil.acre_active is False
    assert profil.unknown_fields == []


def test_aucun_autre_revenu_vaut_bien_zero():
    """« Aucun » seul est une réponse ; « aucune idée » n'en est pas une."""
    assert _nombre("Aucun autre revenu") == 0.0
    assert _nombre("aucune idée") is None


def test_le_parcours_se_termine_meme_si_tout_est_inconnu():
    """Sans la trace des non-réponses, l'onboarding tournerait en rond indéfiniment."""
    _parcourir(UserProfile())  # échoue explicitement s'il ne se termine pas


def _demande_encore(profil: UserProfile, champ: str) -> bool:
    from app.agents.intake.questions import _field_is_missing

    return _field_is_missing(profil, champ)


# -- Les champs de TVA ne sont pas dupliqués ---------------------------------
def test_le_regime_de_tva_n_a_qu_un_seul_champ():
    """`regime_tva` est déjà lu par l'échéancier : un second champ finirait par diverger."""
    for double in ("vat_regime", "eu_vat_number", "versement_liberatoire_opted"):
        assert double not in FIELD_PRIORITY
        assert double not in UserProfile.model_fields
    for reel in ("regime_tva", "numero_tva_intracommunautaire", "versement_liberatoire"):
        assert reel in FIELD_PRIORITY
