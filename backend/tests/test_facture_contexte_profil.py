"""Chaîne onboarding → base → facture : ce que l'utilisateur déclare arrive-t-il au document ?

Les tests du générateur lui passent un `UserProfile` déjà construit. Ils ne disent donc rien du
maillon qui casse le plus facilement : le profil rempli pendant l'onboarding est-il **persisté**
sur le compte, puis **relu** au moment de facturer ?

Ce fichier suit le trajet complet :

    OrchestratorState.profile
      → sync_agent_context_from_state   (écriture en base)
      → users.agent_context.intake.profile
      → _profil_emetteur                (relecture par l'API de facturation)
      → generer_facture                 (mentions et montants du document)

C'est ce trajet qui portait deux défauts réels : `franchise_tva` ignorait le régime de TVA
déclaré, et l'IBAN comme le n° de TVA intracommunautaire étaient lus sous des noms de champs
qui n'existent pas — ils sortaient donc toujours vides.
"""

from __future__ import annotations

import mongomock
import pytest

from app.agents.facture import generator, store as facture_store
from app.agents.facture.schemas import ClientFacture, FactureRequest, LigneFacture
from app.api.facture import _profil_emetteur, contexte_facturation
from app.core import users as users_module
from app.schemas.auth import UserPublic
from app.schemas.orchestrator import OrchestratorState, UserProfile

UID = "u1"


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    client = mongomock.MongoClient()
    db = client["testdb"]
    monkeypatch.setattr(users_module, "users_collection", lambda: db["users"])
    monkeypatch.setattr(users_module, "_ensure_indexes", lambda: None)
    monkeypatch.setattr(facture_store, "get_db", lambda: db)
    monkeypatch.setattr(facture_store, "_initialized", False)
    return db


def _profil_onboarding(**extra) -> UserProfile:
    """Profil tel que l'onboarding le remplit, une fois toutes les questions passées."""
    base = dict(
        siren="812345678", siret="81234567800012", denomination="Studio Nova",
        registry_address="14 rue des Lilas, 69003 Lyon",
        is_entrepreneur_individuel=True, recommended_regime="micro-BNC",
        verification_status="verified",
        fiscal_category="BNC", bnc_caisse="REGIME_GENERAL",
        regime_tva="franchise",
        invoicing_iban="FR7630001007941234567890185",
        numero_tva_intracommunautaire="FR40812345678",
        default_payment_terms="30 jours",
        fiscal_parts=1.0, other_household_income=0.0,
    )
    base.update(extra)
    return UserProfile(**base)


def _persister(db, profil: UserProfile) -> UserPublic:
    """Écrit le profil comme le ferait la fin de l'onboarding, puis relit le compte."""
    db["users"].insert_one({
        "id": UID, "email": "a@b.c", "name": "Nova", "password_hash": "x",
        "created_at": "2026-01-01T00:00:00+00:00", "agent_context": {},
    })
    state = OrchestratorState(
        session_id="s1", phase="done", profile=profil, branch="intake", user_id=UID,
    )
    users_module.sync_agent_context_from_state(state)
    return users_module.get_user_by_id(UID)


def _requete(montant: float = 1000.0) -> FactureRequest:
    return FactureRequest(
        client=ClientFacture(nom="Client SARL", est_professionnel=True,
                             adresse="8 quai Perrache, Lyon", siret="90123456700012"),
        lignes=[LigneFacture(designation="Prestation", quantite=1, prix_unitaire_ht=montant)],
    )


# -- Persistance -------------------------------------------------------------
def test_le_profil_d_onboarding_est_bien_ecrit_en_base(mongo):
    user = _persister(mongo, _profil_onboarding())
    stocke = user.agent_context.intake.profile

    assert stocke is not None
    # Le snapshot est un dump complet : les champs collectés récemment doivent y être.
    for champ in ("regime_tva", "invoicing_iban", "numero_tva_intracommunautaire",
                  "fiscal_category", "bnc_caisse", "fiscal_parts"):
        assert champ in stocke, f"{champ} n'est pas persisté sur le compte"


def test_le_profil_relu_est_identique_a_celui_de_l_onboarding(mongo):
    profil = _profil_onboarding()
    relu = _profil_emetteur(_persister(mongo, profil))

    assert relu.regime_tva == profil.regime_tva
    assert relu.invoicing_iban == profil.invoicing_iban
    assert relu.numero_tva_intracommunautaire == profil.numero_tva_intracommunautaire


# -- Utilisation sur le document --------------------------------------------
def test_l_iban_declare_se_retrouve_sur_la_facture(mongo):
    profil = _profil_emetteur(_persister(mongo, _profil_onboarding()))
    facture = generator.generer_facture(UID, "FA-2026-000001", profil, _requete())

    assert facture.emetteur_iban == "FR7630001007941234567890185"


def test_le_regime_declare_commande_la_tva_du_document(mongo):
    """Franchise déclarée → mention 293 B et TVA nulle, quel que soit `recommended_regime`."""
    profil = _profil_emetteur(_persister(mongo, _profil_onboarding(regime_tva="franchise")))
    facture = generator.generer_facture(UID, "FA-2026-000001", profil, _requete())

    assert facture.emetteur_franchise_tva is True
    assert facture.regime_tva_indetermine is False
    assert facture.total_tva == 0.0


def test_un_micro_assujetti_ne_porte_plus_la_mention_de_franchise(mongo):
    """Cas que l'ancienne heuristique ratait : micro-BNC ET assujetti après franchissement."""
    profil = _profil_emetteur(
        _persister(mongo, _profil_onboarding(recommended_regime="micro-BNC",
                                             regime_tva="reel_simplifie"))
    )
    facture = generator.generer_facture(UID, "FA-2026-000001", profil, _requete())

    assert facture.emetteur_franchise_tva is False
    assert facture.emetteur_tva_intracom == "FR40812345678"


# -- Contexte exposé à l'écran de saisie ------------------------------------
@pytest.mark.asyncio
async def test_le_contexte_annonce_la_franchise_et_le_taux_impose(mongo):
    user = _persister(mongo, _profil_onboarding(regime_tva="franchise"))
    ctx = await contexte_facturation(user=user)

    assert ctx["franchise_tva"] is True
    assert ctx["taux_tva_impose"] == 0.0
    assert "293 B" in (ctx["mention_tva"] or "")
    assert ctx["champs_profil_manquants"] == []


@pytest.mark.asyncio
async def test_le_contexte_signale_un_regime_non_qualifie(mongo):
    """Ni franchise ni assujetti : l'écran doit demander, pas trancher."""
    user = _persister(mongo, _profil_onboarding(regime_tva=None, recommended_regime=None))
    ctx = await contexte_facturation(user=user)

    assert ctx["franchise_tva"] is None
    assert ctx["taux_tva_impose"] is None
    assert [c for c in ctx["champs_profil_manquants"] if c["champ"] == "regime_tva"]


@pytest.mark.asyncio
async def test_le_contexte_signale_un_iban_absent(mongo):
    user = _persister(mongo, _profil_onboarding(invoicing_iban=None))
    ctx = await contexte_facturation(user=user)
    assert [c for c in ctx["champs_profil_manquants"] if c["champ"] == "invoicing_iban"]


@pytest.mark.asyncio
async def test_le_contexte_reclame_le_numero_de_tva_seulement_si_assujetti(mongo):
    """Sous franchise, ce numéro n'a pas lieu d'être : le réclamer serait un faux signal."""
    sous_franchise = _persister(
        mongo, _profil_onboarding(regime_tva="franchise", numero_tva_intracommunautaire=None)
    )
    ctx = await contexte_facturation(user=sous_franchise)
    assert not [c for c in ctx["champs_profil_manquants"]
                if c["champ"] == "numero_tva_intracommunautaire"]


def test_sans_profil_verifie_la_facturation_est_refusee(mongo):
    """Sans SIREN vérifié, l'entreprise n'existe pas légalement : aucune facture possible."""
    from fastapi import HTTPException

    mongo["users"].insert_one({
        "id": "u2", "email": "x@y.z", "name": "Sans profil", "password_hash": "x",
        "created_at": "2026-01-01T00:00:00+00:00", "agent_context": {},
    })
    with pytest.raises(HTTPException) as exc:
        _profil_emetteur(users_module.get_user_by_id("u2"))
    assert exc.value.status_code == 409
