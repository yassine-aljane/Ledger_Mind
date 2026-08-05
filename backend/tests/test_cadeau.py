"""Cadeaux et avantages en nature : estimation par vision, déclaration, consolidation.

Ce que ces tests protègent, dans l'ordre d'importance :
  • le modèle PROPOSE, l'utilisateur DISPOSE — aucune valeur estimée ne devient une
    valeur déclarée sans confirmation humaine explicite ;
  • une estimation douteuse se présente comme douteuse (fourchette, confiance basse)
    plutôt que comme un prix ;
  • une réponse aberrante du modèle ne contamine jamais la base (montants non
    numériques, fourchette inversée, confiance inventée) ;
  • un cadeau déclaré est une RECETTE : il entre dans la base qui situe l'utilisateur
    face au plafond de son régime, sinon on sous-estimerait sa position.

MongoDB est simulé par `mongomock`.
"""

from __future__ import annotations

from datetime import date

import mongomock
import pytest

from app.agents import cadeaux_fiscaux
from app.agents.capture.app.cadeau import _nombre, estimer_cadeau
from app.agents.capture.app.mistral_client import MistralError
from app.agents.facture import store as facture_store
from app.agents.rapport import consolidation, store as rapport_store
from app.core import conversation_store

UID = "user-cadeau-test"


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    client = mongomock.MongoClient()
    db = client["ledgermind_test"]
    monkeypatch.setattr(facture_store, "get_db", lambda: db)
    monkeypatch.setattr(rapport_store, "get_db", lambda: db)
    monkeypatch.setattr(conversation_store, "get_db", lambda: db)
    monkeypatch.setattr(cadeaux_fiscaux, "get_db", lambda: db)
    yield db


class FauxClient:
    """Client Mistral simulé : renvoie le JSON fourni, ou lève l'erreur fournie."""

    def __init__(self, reponse=None, erreur=None):
        self.reponse = reponse or {}
        self.erreur = erreur
        self.appels = 0

    def chat_vision_json(self, *args, **kwargs):
        self.appels += 1
        if self.erreur:
            raise self.erreur
        return self.reponse


# --------------------------------------------------------------- Nettoyage des montants

@pytest.mark.parametrize(
    "brut,attendu",
    [
        (120, 120.0),
        (120.5, 120.5),
        ("120", 120.0),
        ("120.5", 120.5),
        ("120,50", 120.5),      # virgule décimale française
        ("120 €", 120.0),       # symbole toléré
        ("  80  ", 80.0),
        (None, None),
        ("", None),
        ("environ 120", None),  # texte libre : on préfère perdre la valeur
        ("120-150", None),      # ambigu : on ne devine pas laquelle des bornes
        (0, None),              # un prix nul n'est pas une estimation
        (-30, None),
        (True, None),           # bool est un int en Python : ne doit pas passer
    ],
)
def test_nombre_ne_laisse_passer_que_des_prix_plausibles(brut, attendu):
    assert _nombre(brut) == attendu


# ------------------------------------------------------------------------- Estimation

def test_estimation_complete_reprend_les_champs_du_modele():
    client = FauxClient({
        "objet_identifie": "Sac à main en cuir",
        "description": "Sac porté épaule, cuir grainé noir",
        "marque": "Polène",
        "valeur_estimee": 350,
        "fourchette_min": 300,
        "fourchette_max": 400,
        "confiance": "haute",
    })
    est = estimer_cadeau(client, b"...", "image/jpeg")

    assert est.objet_identifie == "Sac à main en cuir"
    assert est.marque == "Polène"
    assert est.valeur_estimee == 350
    assert est.confiance == "haute"
    assert "350" in est.message
    # L'avertissement accompagne TOUJOURS l'estimation, même quand elle est sûre.
    assert est.avertissement


def test_confiance_inventee_est_ramenee_a_faible():
    client = FauxClient({"valeur_estimee": 90, "confiance": "certaine à 200 %"})
    assert estimer_cadeau(client, b"...", "image/jpeg").confiance == "faible"


def test_fourchette_inversee_est_remise_a_lendroit():
    client = FauxClient({
        "objet_identifie": "Bougie",
        "fourchette_min": 150, "fourchette_max": 50, "confiance": "moyenne",
    })
    est = estimer_cadeau(client, b"...", "image/jpeg")
    assert (est.fourchette_min, est.fourchette_max) == (50, 150)
    assert "50–150" in est.message


def test_objet_non_identifie_ne_propose_aucune_valeur():
    client = FauxClient({"objet_identifie": None, "valeur_estimee": None, "confiance": "faible"})
    est = estimer_cadeau(client, b"...", "image/jpeg")

    assert est.valeur_estimee is None
    assert "non identifié" in est.message.lower()
    assert "manuellement" in est.message.lower()


def test_panne_du_modele_ne_bloque_pas_la_declaration():
    """Une estimation indisponible doit laisser saisir la valeur à la main.

    Refuser la déclaration parce que le modèle est en panne empêcherait l'utilisateur
    de déclarer un revenu qu'il a l'obligation de déclarer.
    """
    client = FauxClient(erreur=MistralError("quota dépassé"))
    est = estimer_cadeau(client, b"...", "image/jpeg")

    assert est.valeur_estimee is None
    assert est.confiance == "faible"
    assert "main" in est.message


def test_montant_textuel_du_modele_est_ecarte_et_non_stocke():
    """Le modèle ignore parfois la consigne « nombre simple » : rien ne doit passer."""
    client = FauxClient({
        "objet_identifie": "Montre",
        "valeur_estimee": "entre 200 et 400 euros",
        "confiance": "moyenne",
    })
    est = estimer_cadeau(client, b"...", "image/jpeg")
    assert est.valeur_estimee is None


# ------------------------------------------------------ Human-in-the-loop : le verrou

@pytest.mark.asyncio
async def test_declaration_refusee_sans_confirmation_humaine():
    """Le cœur du dispositif : une estimation ne vaut jamais déclaration.

    Le contrôle est la toute première instruction du handler, avant tout accès base :
    on peut donc l'appeler directement, et son refus prouve qu'aucun montant ne peut
    entrer en comptabilité sans qu'un humain l'ait relu.
    """
    from fastapi import HTTPException

    from app.api.capture import declarer_cadeau

    with pytest.raises(HTTPException) as exc:
        await declarer_cadeau(
            file=None,
            description="Bracelet",
            marque="Youhave",
            date_reception="2026-03-02",
            valeur_ttc=800.0,
            devise="EUR",
            contrepartie=None,
            valeur_confirmee=False,      # l'utilisateur n'a rien confirmé
            valeur_estimee=800.0,
            fourchette_min=None,
            fourchette_max=None,
            confiance="moyenne",
            objet_identifie="Bracelet",
            source_estimation="vision-mistral",
            user=None,
        )

    assert exc.value.status_code == 422
    assert "confirm" in exc.value.detail.lower()


def test_confirmation_absente_vaut_refus_par_defaut():
    """Un client qui oublie le champ doit échouer, pas passer en silence."""
    import inspect

    from app.api.capture import declarer_cadeau

    defaut = inspect.signature(declarer_cadeau).parameters["valeur_confirmee"].default
    # FastAPI enveloppe le défaut dans un objet Form(...) : c'est sa valeur qui compte.
    assert getattr(defaut, "default", defaut) is False


# ------------------------------------------------------------------- Q&A sur un cadeau

def test_qa_cadeau_ne_reclame_pas_de_texte_ocr():
    """Régression : le chat répondait « aucune information dans le texte OCR ».

    Un cadeau est une PHOTO d'objet — il n'a par construction aucun texte à lire. Le
    prompt ne doit donc pas ouvrir de rubrique OCR vide, qui invitait le modèle à
    conclure au manque d'information alors que tous les champs étaient renseignés.
    """
    from app.agents.capture.app import prompts

    champs = {"description": "Bracelet", "marque": "Youhave", "valeur_ttc": 1000.0}
    system, user = prompts.qa_answer(
        "", champs, [], "que dois-je payer sur ce cadeau ?",
        document_type="cadeau", analysis="**Avantage en nature** — à déclarer.",
    )

    assert "Texte du document" not in user      # aucune rubrique vide
    assert "Bracelet" in user                   # les champs sont bien transmis
    assert "Avantage en nature" in user         # la synthèse rédigée aussi
    assert "avantage en nature" in system.lower()
    assert "PHOTO" in system                    # le modèle sait pourquoi il n'y a pas de texte


def test_qa_impose_un_format_lisible_en_panneau_etroit():
    """Le chat s'affiche dans un tiroir de ~340 px.

    Le modèle empilait des « ### 1. », « ### 2. » au fil du texte : un `###` en MILIEU
    de ligne n'est jamais un titre markdown, il restait donc affiché tel quel au milieu
    d'un pavé. La consigne les interdit et impose une structure plate.
    """
    from app.agents.capture.app import prompts

    system, _ = prompts.qa_answer("", {}, [], "q ?", document_type="cadeau")

    assert "FORMAT DE RÉPONSE" in system
    assert "#, ##, ###" in system          # titres interdits
    assert "puces courtes" in system       # structure plate imposée
    assert "150 mots" in system            # longueur bornée


def test_qa_document_texte_conserve_son_ocr():
    """Les pièces qui ONT du texte doivent continuer à le recevoir."""
    from app.agents.capture.app import prompts

    _, user = prompts.qa_answer(
        "FACTURE N°42", {"total_ttc": 120}, [], "combien ?", document_type="facture",
    )
    assert "FACTURE N°42" in user


def test_qa_selectionne_le_bloc_par_type_et_non_par_or():
    """Le bloc métier d'un cadeau ne doit pas retomber sur un dictionnaire vide."""
    from app.agents.capture.app.nodes import _BLOCS

    assert _BLOCS["cadeau"] == "cadeau"
    doc = {"document_type": "cadeau", "cadeau": {"valeur_ttc": 800.0}}
    # Reproduit la sélection faite par answer_question.
    assert doc.get(_BLOCS[doc["document_type"]]) == {"valeur_ttc": 800.0}


# ---------------------------------------------------------------------- Consolidation

def _declarer_cadeau(db, valeur_eur: float, recu: str | None, indice: int = 0) -> None:
    """Écrit un cadeau tel que l'API le persiste — pas un double de la lecture.

    Ces tests passaient auparavant par un stub de `cadeaux_periode`, ce qui laissait la
    conversion en euros et le rattachement à la période hors de leur portée. On écrit
    maintenant en base, et c'est le vrai chemin de lecture qui est exercé.
    """
    db["cadeaux"].insert_one({
        "user_id": UID,
        "document_id": f"doc-cadeau-{indice}",
        "document_type": "cadeau",
        "cadeau": {
            "description": "Bracelet",
            "marque": "Youhave",
            "date_reception": recu,
            "valeur_ttc": valeur_eur,
            "devise": "EUR",
            "valeur_eur": valeur_eur,
        },
    })


def test_cadeaux_declares_alimentent_les_avantages_en_nature(mongo):
    _declarer_cadeau(mongo, 800, "2026-03-02", 1)
    _declarer_cadeau(mongo, 150, "2026-03-20", 2)

    brut = consolidation.consolider(UID, date(2026, 1, 1), date(2026, 12, 31))

    assert brut["avantages_nature"] == 950
    assert brut["nb_cadeaux"] == 2
    assert brut["source_avantages"] == "cadeaux déclarés"


def test_cadeau_hors_periode_est_ignore(mongo):
    _declarer_cadeau(mongo, 800, "2025-11-02")

    brut = consolidation.consolider(UID, date(2026, 1, 1), date(2026, 12, 31))

    assert brut["nb_cadeaux"] == 0
    assert not brut["avantages_nature"]


def test_avantages_en_nature_entrent_dans_la_base_des_seuils(mongo):
    """Un cadeau est une recette : il compte face au plafond, comme un encaissement.

    L'omettre sous-estimerait la position de l'utilisateur — le genre d'erreur qui ne
    se voit qu'au moment où le plafond est franchi sans prévenir.
    """
    _declarer_cadeau(mongo, 1000, "2026-03-02")

    brut = consolidation.consolider(UID, date(2026, 1, 1), date(2026, 12, 31))
    assert brut["recettes_totales"] == brut["total_ht"] + 1000

    analyse = consolidation.analyse_seuils(brut)
    sans_cadeau = consolidation.analyse_seuils({**brut, "recettes_totales": brut["total_ht"]})
    # Les cotisations suivent la base : plus de recettes, plus de cotisations.
    assert analyse["cotisations_estimees"] > sans_cadeau["cotisations_estimees"]


def test_repli_sur_le_profil_quand_aucun_cadeau_declare(mongo):
    """Les dossiers antérieurs à la déclaration pièce par pièce gardent leur valeur."""
    conversation_store.patch_profil(UID, {"remuneration_nature": 150})

    brut = consolidation.consolider(UID, date(2026, 1, 1), date(2026, 12, 31))

    assert brut["avantages_nature"] == 150
    assert brut["source_avantages"] == "profil déclaré"


def test_cadeaux_declares_priment_sur_lestimation_du_profil(mongo):
    """Des pièces datées et confirmées valent mieux qu'une estimation globale."""
    _declarer_cadeau(mongo, 800, "2026-03-02")
    conversation_store.patch_profil(UID, {"remuneration_nature": 150})

    brut = consolidation.consolider(UID, date(2026, 1, 1), date(2026, 12, 31))

    assert brut["avantages_nature"] == 800
    assert brut["source_avantages"] == "cadeaux déclarés"


def test_un_cadeau_sans_date_est_signale_au_lieu_d_etre_perdu(mongo):
    """Sans date il n'entre dans aucun exercice — mais l'utilisateur doit l'apprendre."""
    _declarer_cadeau(mongo, 800, None)

    brut = consolidation.consolider(UID, date(2026, 1, 1), date(2026, 12, 31))

    assert brut["nb_cadeaux"] == 0
    assert [e["motif"] for e in brut["cadeaux_ecartes"]] == ["date de réception manquante"]
