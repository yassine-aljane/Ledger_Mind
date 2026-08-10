"""Transparence IA — ce que l'article 50 exige, vérifié sur les artefacts réellement produits.

Ces tests ne contrôlent pas des constantes : ils ouvrent les PDF que le produit exporte et
regardent ce qui s'y trouve. C'est le seul niveau utile, parce que l'erreur qu'on veut
empêcher n'est pas « la chaîne a changé » mais « la mention a disparu du fichier » —
un pied de page déplacé, un assemblage pypdf qui perd les métadonnées, un rendu qui repart
sur un autre moteur.
"""

from __future__ import annotations

import io
from datetime import date

import pytest
from pypdf import PdfReader

from app.core import ai_act


def _lire(donnees: bytes) -> tuple[dict[str, str], str]:
    """Métadonnées et texte extrait d'un PDF."""
    lecteur = PdfReader(io.BytesIO(donnees))
    meta = {k: str(v) for k, v in (lecteur.metadata or {}).items()}
    texte = "".join(page.extract_text() or "" for page in lecteur.pages)
    return meta, texte


# --------------------------------------------------------------------------- Marquage machine


def test_metadonnees_portent_le_vocabulaire_que_les_verificateurs_lisent():
    """`digitalSourceType` d'IPTC, et pas seulement un libellé maison.

    Un vérificateur automatique ne sait rien faire de « Généré par IA » ; c'est l'URI IPTC
    qu'il traduit en badge « contenu généré par IA ».
    """
    meta = ai_act.metadonnees_document("genere")
    assert "trainedAlgorithmicMedia" in meta["digital_source_type"]
    assert "AI-generated" in meta["keywords"]
    assert "Article 50" in meta["keywords"]


def test_le_niveau_modifie_ne_se_declare_pas_comme_entierement_genere():
    """Les deux niveaux doivent porter des URI DIFFÉRENTS.

    Une facture composée à partir des pièces de l'utilisateur n'est pas un contenu
    entièrement synthétique. Les confondre serait inexact dans les deux sens.
    """
    genere = ai_act.metadonnees_document("genere")["digital_source_type"]
    modifie = ai_act.metadonnees_document("modifie")["digital_source_type"]
    assert genere != modifie
    assert "compositeWithTrainedAlgorithmicMedia" in modifie


def test_entetes_http_annoncent_le_contenu_synthetique():
    entetes = ai_act.entetes_http()
    assert entetes["X-AI-Generated"] == "true"
    assert "digitalsourcetype" in entetes["X-Digital-Source-Type"]


@pytest.mark.parametrize("niveau", ["genere", "modifie", "assiste"])
def test_les_entetes_restent_encodables_en_latin1(niveau):
    """Régression : un accent dans un en-tête fait échouer la réponse ENTIÈRE.

    Les en-têtes HTTP se sérialisent en latin-1. « Généré par IA » y lève un
    UnicodeDecodeError au moment de l'envoi — pas une valeur tronquée, une réponse morte.
    Comme le middleware pose ces en-têtes sur TOUTES les routes, une régression ici
    éteindrait l'API complète, y compris les routes qui n'ont rien à voir avec l'IA.
    """
    for cle, valeur in ai_act.entetes_http(niveau).items():
        cle.encode("latin-1")
        valeur.encode("latin-1")


def test_toute_reponse_d_api_porte_le_marquage_sauf_le_health():
    """Le marquage doit survivre au passage par la pile de middlewares réelle."""
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)

    reponse = client.get("/api/ai-act/transparence")
    assert reponse.status_code == 200
    assert reponse.headers["x-ai-generated"] == "true"

    # `/health` en est exclu : ce n'est pas du contenu, un moniteur n'a rien à en déduire.
    assert "x-ai-generated" not in client.get("/health").headers


# --------------------------------------------------------------------------- Documents exportés


def test_rapport_activite_porte_mention_visible_et_metadonnees():
    from app.agents.rapport.pdf import rapport_to_pdf
    from app.agents.rapport.schemas import RapportActivite

    rapport = RapportActivite(
        id="r1", uid="u1",
        date_debut=date(2026, 1, 1), date_fin=date(2026, 6, 30),
        nb_factures=1, total_ht=1000.0, total_ttc=1000.0,
        ventilation_prestations_ht=1000.0, ventilation_ventes_ht=0.0,
        categorie_fiscale="BNC", seuil_applicable=77700.0, position_vs_seuil_pct=1.3,
        regime_recommande="micro-BNC", cotisations_estimees=211.0, cotisations_taux=0.211,
        cotisations_source="URSSAF", chiffres_cles=[], signaux_conformite=[],
        resume_narratif="", appreciation="", sources=[], created_at="2026-06-30T00:00:00Z",
    )
    meta, texte = _lire(rapport_to_pdf(rapport))

    # Lisible par machine : part avec le fichier.
    assert "AI-generated" in meta.get("/Keywords", "")
    # Lisible par un humain : imprimé dans la page, donc conservé à l'impression.
    assert "[IA]" in texte


def test_dossier_de_declarations_assemble_conserve_le_marquage():
    """Régression : l'assemblage pypdf ne recopie que les pages.

    Sans réécriture explicite des métadonnées après assemblage, le SEUL fichier que
    l'utilisateur télécharge serait le seul à ne porter aucune marque.
    """
    from app.agents.declarations.pdf import jeu_to_pdf

    # Le jeu est construit par le générateur réel plutôt qu'à la main : un schéma monté à la
    # main dériverait du vrai dès qu'un champ change, et ce test cesserait de couvrir le
    # document que les utilisateurs téléchargent.
    from tests.test_declarations import _generer

    meta, _ = _lire(jeu_to_pdf(_generer(), {"denomination": "ACME", "siren": "1"}))
    assert "AI-generated" in meta.get("/Keywords", "")


def test_mention_de_reproduction_porte_la_divulgation_ia():
    """Le formulaire officiel n'accepte pas de pied ajouté : la mention passe par le seul
    emplacement libre de la page, rendu sur CHAQUE gabarit."""
    from app.agents.declarations.templates import _MENTION_REPRODUCTION

    assert "[IA]" in _MENTION_REPRODUCTION
    assert "intelligence artificielle" in _MENTION_REPRODUCTION


# --------------------------------------------------------------------------- Signature


def test_le_pdf_n_est_pas_signable_par_c2pa():
    """C2PA ne couvre pas le PDF — ni le SDK, ni la liste du guide.

    Ce test existe pour empêcher qu'on rebranche un jour `signer()` sur les générateurs de
    PDF en croyant y gagner une preuve de provenance : l'appel serait un no-op silencieux,
    et le marquage réel (les métadonnées) passerait pour redondant.
    """
    assert ai_act.format_signable("application/pdf") is False


def test_absence_de_cle_ne_casse_pas_un_telechargement(monkeypatch):
    """Sans chaîne configurée, `signer()` rend l'actif tel quel.

    Un poste de développement sans clé ne doit pas empêcher un utilisateur de récupérer sa
    facture : la signature est une couche de preuve en plus du marquage déjà présent.
    """
    ai_act.config_signature.cache_clear()
    monkeypatch.setattr(ai_act, "config_signature", lambda: None)

    charge = b"%PDF-1.4 contenu"
    assert ai_act.signer(charge, "application/pdf") == charge


def test_manifeste_declare_laction_de_creation_par_ia():
    """C'est `c2pa.actions` qui porte l'obligation, pas les assertions descriptives."""
    manifeste = ai_act.manifeste_c2pa("genere", "Test")
    actions = next(
        a for a in manifeste["assertions"] if a["label"] == "c2pa.actions"
    )["data"]["actions"]
    assert actions[0]["action"] == "c2pa.created"
    assert "trainedAlgorithmicMedia" in actions[0]["digitalSourceType"]


@pytest.mark.skipif(
    ai_act.config_signature() is None,
    reason="aucune chaîne C2PA configurée (voir backend/certs/README.md)",
)
def test_la_chaine_configuree_est_utilisable():
    config = ai_act.config_signature()
    assert config is not None
    assert config.cle.exists() and config.chaine.exists()
    assert config.algorithme == "es256"
    # La chaîne doit contenir la feuille ET son émetteur : C2PA valide un chemin, pas un
    # certificat isolé.
    assert config.chaine.read_text(encoding="utf-8").count("BEGIN CERTIFICATE") >= 2
    # PKCS#8 et non SEC1 : une clé SEC1 passe toutes les vérifications openssl et n'échoue
    # qu'au moment de signer, avec « unexpected PEM type label ».
    assert config.cle.read_text(encoding="utf-8").startswith("-----BEGIN PRIVATE KEY-----")


@pytest.mark.skipif(
    ai_act.config_signature() is None or not ai_act.format_signable("image/png"),
    reason="chaîne C2PA ou SDK c2pa-python absent",
)
def test_une_image_signee_porte_un_manifeste_relisible():
    """Bout en bout : on signe, puis on relit le manifeste DEPUIS les octets produits.

    C'est le seul test qui prouve que la chaîne générée par `generer_cles_signature.py` est
    réellement utilisable — le reste ne vérifie que sa forme.
    """
    import json

    from c2pa import Reader

    from app.core.paths import REPO_ROOT

    source = (REPO_ROOT / "frontend/public/invoice-templates/minimal.png").read_bytes()
    signe = ai_act.signer(source, "image/png", "genere", "Gabarit Épure")
    assert signe != source, "la signature n'a pas été incrustée"

    with Reader("image/png", io.BytesIO(signe)) as lecteur:
        manifeste = json.loads(lecteur.json())

    actif = manifeste["manifests"][manifeste["active_manifest"]]
    actions = next(
        a for a in actif["assertions"] if a["label"].startswith("c2pa.actions")
    )["data"]["actions"]
    assert actions[0]["action"] == "c2pa.created"
    assert "trainedAlgorithmicMedia" in actions[0]["digitalSourceType"]

    # La signature elle-même doit être valide. `signingCredential.untrusted` reste attendu
    # tant que l'autorité est interne (voir backend/certs/README.md) : c'est un défaut
    # d'ancrage, pas un défaut de signature.
    resultats = manifeste["validation_results"]["activeManifest"]
    codes_ok = {v["code"] for v in resultats.get("success", [])}
    assert "claimSignature.validated" in codes_ok
    assert "assertion.dataHash.match" in codes_ok
    echecs = {v["code"] for v in resultats.get("failure", [])}
    assert echecs <= {"signingCredential.untrusted"}, f"échecs inattendus : {echecs}"


# --------------------------------------------------------------------------- Point d'entrée public


def test_etat_de_transparence_est_consultable_et_complet():
    """Cet objet est la documentation d'audit exigée par le guide : produit par le code,
    donc incapable de dériver d'avec ce que le code fait réellement."""
    etat = ai_act.etat_transparence()
    assert etat["marquage_visible"] is True
    assert etat["marquage_metadonnees"] is True
    assert set(etat["niveaux"]) == {"genere", "modifie", "assiste"}
    assert etat["echeance_marquage_machine"] == "2026-12-02"
