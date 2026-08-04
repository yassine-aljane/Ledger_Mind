"""Veille fiscale personnalisée — ce que l'agent doit garantir.

Couvre les règles qui ne doivent jamais céder :
  • déduplication d'une même mesure reprise par plusieurs sources ;
  • une source de presse seule ne publie rien ;
  • une nouveauté qui contredit franchement le profil est écartée ;
  • un champ INCONNU du profil n'exclut pas, mais ne déclenche pas de notification ;
  • le plafond hebdomadaire ne fait jamais disparaître une action obligatoire.
"""

from __future__ import annotations

import pytest

from app.veille import agent
from app.veille.modele import Criteres, Nouveaute, Source, cle_dedup, maintenant
from app.veille.profil import ProfilVeille
from app.veille.scoring import SEUIL_NOTIFICATION, evaluer, notifiable


def _nouveaute(**kwargs) -> Nouveaute:
    base = dict(
        id="n1",
        titre="Titre",
        resume="Résumé.",
        impact="information",
        echeance=None,
        sources=[Source(libelle="BOFiP", url="https://bofip.impots.gouv.fr/x", autorite=1)],
        criteres=Criteres(),
        date_collecte=maintenant(),
        date_verification=maintenant(),
    )
    base.update(kwargs)
    return Nouveaute(**base)


def _profil(**kwargs) -> ProfilVeille:
    base = dict(uid="u1", champs_connus={"tax_category"})
    base.update(kwargs)
    return ProfilVeille(**base)


# ------------------------------------------------------------------ Déduplication


def test_meme_mesure_deux_formulations_donne_une_seule_cle():
    a = cle_dedup("Le plafond du micro-BNC est relevé pour 2026")
    b = cle_dedup("Relèvement du plafond micro-BNC pour 2026")
    assert a == b


def test_deux_echeances_differentes_restent_deux_nouveautes():
    a = cle_dedup("Déclaration de TVA", echeance="2026-05-15")
    b = cle_dedup("Déclaration de TVA", echeance="2026-08-15")
    assert a != b


# ------------------------------------------------------------------ Sourçage


def test_la_presse_seule_ne_publie_rien():
    """Autorité 3 : peut faire repérer un sujet, jamais l'affirmer."""
    candidat = {"titre": "T", "url": "https://exemple.fr/a", "source": "Presse", "autorite": 3}
    qualif = {"resume": "R", "impact": "information", "criteres": {}}
    assert agent._construire(candidat, qualif, "c1") is None


def test_une_source_officielle_publie():
    candidat = {"titre": "T", "url": "https://bofip.impots.gouv.fr/a", "source": "BOFiP", "autorite": 1}
    qualif = {"resume": "R", "impact": "information", "criteres": {}}
    assert agent._construire(candidat, qualif, "c1") is not None


def test_sans_url_rien_nest_publiable():
    candidat = {"titre": "T", "url": "", "source": "BOFiP", "autorite": 1}
    qualif = {"resume": "R", "impact": "information", "criteres": {}}
    assert agent._construire(candidat, qualif, "c1") is None


def test_un_critere_hors_vocabulaire_est_ecarte_pas_propage():
    criteres = Criteres(seuils=["micro_bnc", "seuil_invente"], activites=["influenceur", "martien"])
    normalise = criteres.normalise()
    assert normalise.seuils == ["micro_bnc"]
    assert normalise.activites == ["influenceur"]


# ------------------------------------------------------------------ Scoring


def test_contradiction_franche_exclut():
    """Mesure réservée au BIC, profil BNC connu : elle ne doit pas remonter."""
    verdict = evaluer(
        _nouveaute(criteres=Criteres(tax_categories=["BIC"])),
        _profil(tax_category="BNC"),
    )
    assert verdict.retenue is False


def test_profil_mixte_est_concerne_par_bnc_et_bic():
    for categorie in ("BNC", "BIC"):
        verdict = evaluer(
            _nouveaute(criteres=Criteres(tax_categories=[categorie])),
            _profil(tax_category="mixed"),
        )
        assert verdict.retenue is True


def test_champ_inconnu_nexclut_pas_mais_ne_notifie_pas():
    """On ignore la catégorie fiscale : la mesure reste consultable, sans notification."""
    verdict = evaluer(
        _nouveaute(criteres=Criteres(tax_categories=["BIC"])),
        _profil(tax_category=None, champs_connus={"activite"}),
    )
    assert verdict.retenue is True
    assert verdict.score < SEUIL_NOTIFICATION


def test_rattachement_justifie_et_champs_declencheurs_renseignes():
    verdict = evaluer(
        _nouveaute(criteres=Criteres(tax_categories=["BNC"], regimes_tva=["franchise"])),
        _profil(tax_category="BNC", regime_tva="franchise"),
    )
    assert verdict.retenue is True
    assert verdict.pourquoi_vous
    assert "tax_category" in verdict.champs_declencheurs
    assert "regime_tva" in verdict.champs_declencheurs


def test_mesure_generale_est_consultable_mais_pas_notifiee():
    verdict = evaluer(_nouveaute(criteres=Criteres()), _profil(tax_category="BNC"))
    assert verdict.retenue is True
    assert verdict.score < SEUIL_NOTIFICATION


def test_seuil_non_suivi_exclut_quand_les_seuils_du_profil_sont_connus():
    verdict = evaluer(
        _nouveaute(criteres=Criteres(seuils=["micro_bic_vente"])),
        _profil(tax_category="BNC", seuils_suivis={"micro_bnc", "tva_franchise_services"}),
    )
    assert verdict.retenue is False


def test_source_opposable_pese_plus_quune_note_administrative():
    criteres = Criteres(tax_categories=["BNC"])
    profil = _profil(tax_category="BNC")
    opposable = evaluer(_nouveaute(criteres=criteres), profil)
    administrative = evaluer(
        _nouveaute(
            criteres=criteres,
            sources=[Source(libelle="URSSAF", url="https://urssaf.fr/x", autorite=2)],
        ),
        profil,
    )
    assert opposable.score > administrative.score


# ------------------------------------------------------------------ Notification


def test_mode_obligatoire_seulement_filtre_le_reste():
    profil = _profil(tax_category="BNC", regime_tva="franchise")
    info = _nouveaute(criteres=Criteres(tax_categories=["BNC"], regimes_tva=["franchise"]))
    obligation = _nouveaute(
        impact="action_obligatoire",
        criteres=Criteres(tax_categories=["BNC"], regimes_tva=["franchise"]),
    )
    assert notifiable(evaluer(info, profil), info, "tout") is True
    assert notifiable(evaluer(info, profil), info, "obligatoire_seulement") is False
    assert notifiable(evaluer(obligation, profil), obligation, "obligatoire_seulement") is True


def test_un_profil_vide_ne_declenche_aucune_notification():
    """Sans champ discriminant, notifier reviendrait à envoyer de la veille générique."""
    resultat = agent.distribuer(ProfilVeille(uid="u-vide"))
    assert resultat["notifiees"] == 0
    assert "incomplet" in resultat["raison"]


@pytest.mark.asyncio
async def test_qualification_impossible_nest_pas_une_nouveaute_sans_critere(monkeypatch):
    """Un LLM en échec ne doit pas produire une nouveauté diffusée à tout le monde."""

    async def boom(*args, **kwargs):
        raise RuntimeError("LLM indisponible")

    monkeypatch.setattr("app.veille.agent.chat_json_with_system", boom)
    assert await agent.qualifier("Titre", "Texte") is None


@pytest.mark.asyncio
async def test_publication_non_pertinente_est_ecartee(monkeypatch):
    async def faux(*args, **kwargs):
        return {"pertinent": False, "resume": "…"}

    monkeypatch.setattr("app.veille.agent.chat_json_with_system", faux)
    assert await agent.qualifier("Titre", "Texte") is None


# ------------------------------------------------------------------ Filtre de bruit


def test_les_avis_de_vacance_demploi_sont_ecartes_sans_appel_llm():
    """La recherche Légifrance interroge en « un des mots » : sans ce filtre, un cycle réel
    dépense un appel LLM par avis de nomination pour s'entendre répondre « non pertinent »."""
    assert agent.est_bruit("Avis de vacance d'un emploi de sous-directeur")
    assert agent.est_bruit("Arrêté du 3 août 2026 portant nomination au conseil")
    assert agent.est_bruit("Avis de vacance de l'emploi de directeur de l'INJEP")


def test_un_texte_fiscal_nest_pas_pris_pour_du_bruit():
    assert not agent.est_bruit("CFE 2025 : date limite de paiement fixée au 15 décembre 2025")
    assert not agent.est_bruit("Déclaration européenne de services (DES)")
    assert not agent.est_bruit("Relèvement du plafond micro-BNC pour 2026")


# ------------------------------------------------------------------ Fraîcheur


def test_une_echeance_passee_est_detectee():
    """« Action obligatoire avant le 15/12/2025 » affiché en août 2026 : à la fois faux et
    anxiogène. C'est le défaut qu'on a constaté à l'écran."""
    assert _nouveaute(echeance="2020-01-01").echeance_depassee is True
    assert _nouveaute(echeance="2099-01-01").echeance_depassee is False
    assert _nouveaute(echeance=None).echeance_depassee is False


def test_une_page_de_reference_nest_pas_une_actualite():
    """Le calendrier fiscal ou « comment déposer une CA12 » décrivent une règle inchangée :
    ils appartiennent au corpus du pédagogue, pas à un fil d'actualité."""
    candidat = {"titre": "T", "url": "https://impots.gouv.fr/a", "source": "DGFiP", "autorite": 2}
    reference = agent._construire(
        candidat, {"resume": "R", "nature": "reference", "criteres": {}}, "c1"
    )
    actualite = agent._construire(
        candidat, {"resume": "R", "nature": "actualite", "criteres": {}}, "c1"
    )
    assert reference.nature == "reference"
    assert actualite.nature == "actualite"


def test_la_nature_par_defaut_est_reference():
    """Dans le doute, on ne publie pas : une qualification muette ne doit pas remplir le fil."""
    candidat = {"titre": "T", "url": "https://impots.gouv.fr/a", "source": "DGFiP", "autorite": 2}
    item = agent._construire(candidat, {"resume": "R", "criteres": {}}, "c1")
    assert item.nature == "reference"
