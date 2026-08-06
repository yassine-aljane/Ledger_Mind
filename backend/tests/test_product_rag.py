"""Tests hors réseau du chatbot produit Mistral + Pinecone."""

from __future__ import annotations

import asyncio

from fastapi import HTTPException
import pytest

from app.api import product_assistant
from app.product_rag import agent, pinecone_store
from app.product_rag.knowledge import load_product_chunks, parse_product_document


def _run(coro):
    return asyncio.run(coro)


def test_documentation_produit_est_indexable_et_complete():
    chunks = load_product_chunks()

    assert len(chunks) >= 70
    assert len({chunk.id for chunk in chunks}) == len(chunks)
    assert all(chunk.question and chunk.section and chunk.text for chunk in chunks)
    assert all(chunk.metadata()["source"] == "DOCUMENTATION_RAG_LEDGERMIND.md" for chunk in chunks)
    assert any("29 €" in chunk.text and "Premium" in chunk.text for chunk in chunks)
    assert any("Démonstration" in chunk.text for chunk in chunks)


def test_decoupe_ne_melange_pas_deux_sections():
    document = """# Produit
## Première section
### Question : Première question ?

**Réponse :** Première réponse.

## Deuxième section
### Question : Deuxième question ?

**Réponse :** Deuxième réponse.
"""

    chunks = parse_product_document(document)

    assert [chunk.section for chunk in chunks] == ["Première section", "Deuxième section"]
    assert "Deuxième section" not in chunks[0].text
    assert "Deuxième réponse" not in chunks[0].text
    assert chunks[1].question == "Deuxième question ?"


def test_agent_utilise_les_extraits_et_renvoie_des_sources(monkeypatch):
    async def faux_embedding(question):
        assert question == "Quel est le prix ?"
        return [0.25, 0.75]

    def fausse_recherche(vector):
        assert vector == [0.25, 0.75]
        return [
            {
                "id": "prix",
                "score": 0.92,
                "metadata": {
                    "question": "Quel est le prix de Premium ?",
                    "section": "Offres, tarifs et accès",
                    "text": "Premium est affiché à 29 € par mois, sans engagement.",
                },
            }
        ]

    async def faux_chat(system, prompt, **kwargs):
        assert "uniquement à partir" in system
        assert "29 € par mois" in prompt
        assert kwargs["temperature"] == 0.15
        return "Premium coûte 29 € par mois et est sans engagement."

    monkeypatch.setattr(agent, "embed_one", faux_embedding)
    monkeypatch.setattr(agent.pinecone_store, "query", fausse_recherche)
    monkeypatch.setattr(agent, "chat_text", faux_chat)

    resultat = _run(agent.answer("Quel est le prix ?"))

    assert resultat["answer"].startswith("Premium coûte 29 €")
    assert resultat["sources"] == [
        {
            "title": "Quel est le prix de Premium ?",
            "section": "Offres, tarifs et accès",
            "score": 0.92,
        }
    ]


def test_agent_ne_fait_pas_appel_au_llm_sans_extrait(monkeypatch):
    async def faux_embedding(_question):
        return [1.0]

    def aucune_recherche(_vector):
        return []

    async def chat_interdit(*_args, **_kwargs):
        pytest.fail("Le LLM ne doit pas improviser sans documentation.")

    monkeypatch.setattr(agent, "embed_one", faux_embedding)
    monkeypatch.setattr(agent.pinecone_store, "query", aucune_recherche)
    monkeypatch.setattr(agent, "chat_text", chat_interdit)

    resultat = _run(agent.answer("Une question inconnue"))

    assert resultat == {"answer": agent.NO_DOCUMENTATION, "sources": []}


def test_api_transforme_une_base_non_configuree_en_503(monkeypatch):
    async def indisponible(*_args, **_kwargs):
        raise pinecone_store.ProductKnowledgeUnavailable("clé absente")

    monkeypatch.setattr(product_assistant.agent, "answer", indisponible)
    payload = product_assistant.ProductChatRequest(question="Comment fonctionne LedgerMind ?")

    with pytest.raises(HTTPException) as erreur:
        _run(product_assistant.chat(payload))

    assert erreur.value.status_code == 503
    assert "Pinecone" in erreur.value.detail


def test_question_de_suivi_reutilise_le_dernier_sujet_utilisateur(monkeypatch):
    requete_vectorisee = ""

    async def faux_embedding(question):
        nonlocal requete_vectorisee
        requete_vectorisee = question
        return [1.0]

    monkeypatch.setattr(agent, "embed_one", faux_embedding)
    monkeypatch.setattr(agent.pinecone_store, "query", lambda _vector: [])

    _run(
        agent.answer(
            "Et l'offre gratuite ?",
            [
                {"role": "user", "content": "Combien coûte Premium ?"},
                {"role": "assistant", "content": "Premium coûte 29 € par mois."},
            ],
        )
    )

    assert "Combien coûte Premium ?" in requete_vectorisee
    assert "Et l'offre gratuite ?" in requete_vectorisee


def test_normalisation_des_resultats_pinecone(monkeypatch):
    class FauxIndex:
        def query(self, **kwargs):
            assert kwargs["namespace"]
            assert kwargs["include_metadata"] is True
            return {
                "matches": [
                    {"id": "ok", "score": 0.8, "metadata": {"text": "Un extrait"}},
                    {"id": "vide", "score": 0.9, "metadata": {}},
                ]
            }

    monkeypatch.setattr(pinecone_store, "index", lambda: FauxIndex())

    assert pinecone_store.query([0.1]) == [
        {"id": "ok", "score": 0.8, "metadata": {"text": "Un extrait"}}
    ]


def test_premiere_indexation_cree_un_namespace_absent(monkeypatch):
    vecteurs_envoyes = []

    class NamespaceAbsent(Exception):
        status_code = 404

    class FauxIndex:
        def delete(self, **kwargs):
            assert kwargs["delete_all"] is True
            raise NamespaceAbsent("Namespace not found")

        def upsert(self, *, vectors, namespace):
            assert namespace
            vecteurs_envoyes.extend(vectors)

    vecteurs = [{"id": "premier", "values": [0.1], "metadata": {"text": "Texte"}}]
    monkeypatch.setattr(pinecone_store, "index", lambda: FauxIndex())

    assert pinecone_store.replace(vecteurs) == 1
    assert vecteurs_envoyes == vecteurs
