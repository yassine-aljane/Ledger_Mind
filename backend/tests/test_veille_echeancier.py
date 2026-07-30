"""Veille réglementaire appliquée au moteur d'échéances (chantier RAG dynamique).

Couvre ce que l'intégration doit préserver :
  • seules les obligations portant un `verif_motif` sont vérifiées à la source ;
  • un motif toujours présent est "confirme", jamais un "écart" fabriqué ;
  • un motif absent est signalé ("ecart_possible") mais data/regimes/*.yaml n'est JAMAIS modifié ;
  • une source MCP indisponible ne fait pas planter le cycle de veille.
"""

from __future__ import annotations

import pytest

from app.veille import scheduler


def test_cibles_echeancier_ne_garde_que_les_obligations_avec_motif():
    cibles = scheduler._cibles_echeancier()
    assert cibles, "au moins une obligation sourcée doit porter un verif_motif"
    assert all(c.get("verif_motif") for c in cibles)


def test_motif_present_insensible_a_la_casse_et_aux_espaces():
    assert scheduler._motif_present("15 décembre", "Paiement au plus tard le   15   DÉCEMBRE.")
    assert not scheduler._motif_present("15 décembre", "Paiement au plus tard le 20 décembre.")


@pytest.mark.asyncio
async def test_verifier_echeancier_confirme_quand_le_motif_est_present(monkeypatch):
    async def fake_call_tool(server, tool, args):
        return {"texte": "Le paiement doit intervenir avant le 15 décembre de chaque année."}

    monkeypatch.setattr("app.mcp.client.call_tool", fake_call_tool)
    resultats = await scheduler.verifier_echeancier()
    cfe = next(r for r in resultats if r["label"] == "Cotisation Foncière des Entreprises (CFE)")
    assert cfe["statut"] == "confirme"


@pytest.mark.asyncio
async def test_verifier_echeancier_signale_un_ecart_sans_rien_ecraser(monkeypatch, tmp_path):
    async def fake_call_tool(server, tool, args):
        return {"texte": "Cette page ne mentionne plus aucune date limite."}

    monkeypatch.setattr("app.mcp.client.call_tool", fake_call_tool)
    resultats = await scheduler.verifier_echeancier()
    assert any(r["statut"] == "ecart_possible" for r in resultats)
    # Le Rule Engine lui-même reste inchangé — un écart est un signal, jamais une écriture.
    from app.agents.echeancier import regles
    cfe = next(o for o in regles.obligations_pour_regime("micro") if o["id"] == "cfe")
    assert cfe["verif_motif"] == "15 décembre"


@pytest.mark.asyncio
async def test_verifier_echeancier_tolere_une_source_indisponible(monkeypatch):
    async def fake_call_tool(server, tool, args):
        raise RuntimeError("MCP indisponible")

    monkeypatch.setattr("app.mcp.client.call_tool", fake_call_tool)
    resultats = await scheduler.verifier_echeancier()
    assert all(r["statut"] == "inaccessible" for r in resultats)
