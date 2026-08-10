"""Corpus documentaire (RAG sur MongoDB) et agent pédagogique.

Aucun appel réseau : les embeddings et le LLM sont simulés, MongoDB tourne en mémoire.
Ce qui est vérifié est la logique qui doit survivre aux intégrations :
  • la découpe par article juridique ;
  • le tri des extraits par pertinence PONDÉRÉE par l'autorité de la source ;
  • le filtrage par public (`concerne`) ;
  • l'avertissement de fraîcheur ;
  • le comportement quand le corpus est vide ou la recherche indisponible — on ne répond jamais
    au hasard ;
  • les sources renvoyées avec la réponse.
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta

import mongomock
import pytest

from app.agents.pedagogue import agent as pedagogue
from app.rag import embeddings as emb
from app.rag import ingest, retriever, vectorstore


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    client = mongomock.MongoClient()
    monkeypatch.setattr(vectorstore, "get_db", lambda: client["ledgermind_test"])
    monkeypatch.setattr(vectorstore, "_initialized", False)
    yield
    monkeypatch.setattr(vectorstore, "_initialized", False)


@pytest.fixture
def embeddings_simules(monkeypatch):
    """Embedding déterministe : un vecteur de présence de mots-clés, comparable en cosinus."""
    VOCAB = ["cadeau", "tva", "micro", "seuil", "revenu", "urssaf"]

    async def _embed(textes):
        return [[1.0 if mot in t.lower() else 0.0 for mot in VOCAB] for t in textes]

    async def _embed_one(texte):
        return (await _embed([texte]))[0]

    monkeypatch.setattr(emb, "embed", _embed)
    monkeypatch.setattr(ingest, "embed", _embed)
    monkeypatch.setattr(retriever, "embed_one", _embed_one)


def _run(coro):
    return asyncio.run(coro)


def _ingerer(texte, *, titre, source, autorite, concerne=None, date_verif=None):
    nb = _run(ingest.ingest_document(
        text=texte, source=source, titre=titre, url=f"https://exemple.fr/{titre}",
        type_doc="doctrine", autorite=autorite, concerne=concerne or ["tous"],
    ))
    if date_verif:
        vectorstore.collection().update_many({"titre": titre},
                                             {"$set": {"date_verification": date_verif}})
    return nb


# ------------------------------------------------------------------------------ Découpe
def test_decoupe_par_article_juridique():
    texte = (
        "Article 1 Les revenus tirés d'une activité professionnelle sont imposables selon leur "
        "nature réelle et leur origine, quelle que soit la forme de leur versement. "
        "Article 2 Les avantages en nature reçus en contrepartie d'une prestation sont évalués "
        "à leur valeur vénale, c'est-à-dire au prix réel du bien remis au bénéficiaire."
    )
    morceaux = ingest.chunk(texte)
    assert len(morceaux) == 2
    assert morceaux[0].startswith("Article 1")
    assert morceaux[1].startswith("Article 2")
    # Les fragments trop courts (< 80 caractères) sont écartés : ils n'apportent aucun contexte.
    assert ingest.chunk("Article 1 Trop court. Article 2 Aussi.") == []


def test_decoupe_repli_sans_article():
    morceaux = ingest.chunk("a" * 3500)
    assert len(morceaux) == 3          # 1600 + 1600 + 300


def test_texte_vide_nest_pas_ingere(embeddings_simules):
    assert _run(ingest.ingest_document(text="   ", source="X", titre="T", url="u",
                                       type_doc="guide")) == 0


# ------------------------------------------------------------------------------ Recherche
def test_autorite_departage_a_pertinence_egale(embeddings_simules):
    _ingerer("Un cadeau reçu est un revenu imposable.", titre="Guide privé",
             source="Blog", autorite=3)
    _ingerer("Un cadeau reçu est un revenu imposable.", titre="Doctrine BOFiP",
             source="BOFiP", autorite=2)
    _ingerer("Un cadeau reçu est un revenu imposable.", titre="Code général des impôts",
             source="Légifrance", autorite=1)

    res = _run(retriever.search("cadeau revenu", k=3))
    assert [h["source"] for h in res["hits"]] == ["Légifrance", "BOFiP", "Blog"]


def test_filtrage_par_public(embeddings_simules):
    _ingerer("Seuil micro spécifique.", titre="Fiche influenceur", source="URSSAF",
             autorite=2, concerne=["influenceur"])
    _ingerer("Seuil micro général.", titre="Fiche tous publics", source="URSSAF", autorite=2)

    titres = {h["titre"] for h in _run(retriever.search("micro seuil", k=5, concerne="freelance"))["hits"]}
    assert titres == {"Fiche tous publics"}   # la fiche influenceur est écartée


def test_avertissement_fraicheur(embeddings_simules):
    vieux = (date.today() - timedelta(days=400)).isoformat()
    _ingerer("La TVA s'applique au-delà du seuil.", titre="Vieille fiche", source="BOFiP",
             autorite=2, date_verif=vieux)
    res = _run(retriever.search("tva seuil", k=3))
    assert res["au_moins_un_perime"] is True
    assert res["hits"][0]["perime"] is True


def test_corpus_vide_ne_declenche_aucune_recherche(embeddings_simules):
    res = _run(retriever.search("cadeau", k=3))
    assert res == {"hits": [], "corpus_vide": True, "au_moins_un_perime": False}


def test_embeddings_indisponibles_ne_renvoient_rien(embeddings_simules, monkeypatch):
    _ingerer("Un cadeau est un revenu.", titre="Fiche", source="BOFiP", autorite=2)

    async def _panne(texte):
        raise emb.EmbeddingIndisponible("quota")

    monkeypatch.setattr(retriever, "embed_one", _panne)
    res = _run(retriever.search("cadeau", k=3))
    assert res["hits"] == []
    assert res["recherche_indisponible"] is True


# ---------------------------------------------------------------------------- Pédagogue
@pytest.fixture
def llm_simule(monkeypatch):
    async def _chat(system, prompt, **kwargs):
        # On vérifie que les extraits ET la position déterministe arrivent bien au modèle.
        return f"REPONSE|extraits={'Extraits du corpus' in prompt}|verdict={'DÉTERMINISTE' in prompt}"

    monkeypatch.setattr(pedagogue, "chat_text", _chat)

    async def _pas_de_bofip(question):
        return []

    monkeypatch.setattr(pedagogue, "_bofip_live", _pas_de_bofip)


def test_reponse_citant_ses_sources(embeddings_simules, llm_simule):
    _ingerer("Un cadeau reçu en contrepartie d'une prestation est un revenu imposable.",
             titre="Doctrine cadeaux", source="BOFiP", autorite=2)
    out = _run(pedagogue.answer("Les cadeaux sont-ils un revenu ?"))
    assert out["sources"][0]["source"] == "BOFiP"
    assert out["sources"][0]["url"]
    assert "extraits=True" in out["reponse"]


def test_verdict_deterministe_transmis_au_modele(embeddings_simules, llm_simule):
    _ingerer("Le seuil micro conditionne le régime.", titre="Seuils", source="URSSAF", autorite=2)
    out = _run(pedagogue.answer("Quel régime pour moi ?",
                                regime_verdict={"parcours": "bascule", "phrase": "À arbitrer."}))
    assert "verdict=True" in out["reponse"]


def test_corpus_vide_message_explicite(embeddings_simules, llm_simule):
    out = _run(pedagogue.answer("Une question"))
    assert out["reponse"] == pedagogue.CORPUS_VIDE
    assert out["sources"] == []


def test_mots_cles_pour_la_recherche_bofip():
    assert pedagogue.mots_cles("Est-ce que je dois déclarer mes cadeaux ?") == "déclarer cadeaux"


def test_extrait_graphe_et_tableau_valides_de_la_reponse():
    brut = (
        "Voici la comparaison sourcée.\n"
        '<visualisation>{"type":"bar","title":"Abattements",'
        '"unit":"%","data":[{"label":"Micro-BNC","value":34},'
        '{"label":"Micro-BIC","value":50}]}</visualisation>\n'
        '<visualisation>{"type":"table","title":"Comparaison",'
        '"columns":["Critère","BNC","BIC"],'
        '"rows":[["Activité","Libérale","Commerciale"]]}</visualisation>'
    )

    texte, visualisations = pedagogue.extraire_visualisations(brut)

    assert texte == "Voici la comparaison sourcée."
    assert visualisations[0]["type"] == "bar"
    assert visualisations[0]["data"][0] == {"label": "Micro-BNC", "value": 34.0}
    assert visualisations[1]["type"] == "table"
    assert visualisations[1]["rows"] == [["Activité", "Libérale", "Commerciale"]]


def test_rejette_un_graphe_incomplet_ou_non_numerique():
    brut = (
        "Réponse normale. "
        '<visualisation>{"type":"bar","title":"Comparaison",'
        '"data":[{"label":"A","value":"inconnu"}]}</visualisation>'
    )

    texte, visualisations = pedagogue.extraire_visualisations(brut)

    assert texte == "Réponse normale."
    assert visualisations == []
