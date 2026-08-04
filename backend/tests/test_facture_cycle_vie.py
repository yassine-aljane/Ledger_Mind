"""Cycle de vie de la facture émise : brouillon, émission, acompte, avoir, seuil TVA.

Complète `test_facture.py` (mentions légales et numérotation), qui reste la référence sur
la conformité du contenu.

Couvre ce que l'intégration doit préserver :
  • un BROUILLON ne consomme aucun numéro — l'abandonner ne laisse pas de trou, ce que la
    loi interdit ; l'émission seule attribue le numéro et fige le document ;
  • une facture émise ne se modifie ni ne se supprime : elle se corrige par AVOIR, et les
    deux documents restent archivés ;
  • l'indemnité forfaitaire de recouvrement ne se mentionne PAS face à un particulier —
    l'afficher serait une mention abusive ;
  • deux séquences distinctes et continues (FA / AV), atomiques sous concurrence ;
  • le régime de TVA reste DÉCLARATIF : le système alerte sur le seuil, il ne bascule jamais seul.

`mongomock` remplace MongoDB ; aucun appel LLM.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import mongomock
import pytest

from app.agents.facture import generator, reglementaire, store
from app.agents.facture.pdf import facture_to_pdf
from app.agents.facture.schemas import Acompte, ClientFacture, FactureRequest, LigneFacture
from app.schemas.orchestrator import UserProfile


@pytest.fixture(autouse=True)
def _mongo(monkeypatch):
    """Base isolée par test, et schéma réinitialisé (le store mémorise son init).

    On patche `store.get_db` et non `app.core.mongo.get_db` : le store importe le nom
    (`from … import get_db`), il est donc lié dans son propre module.
    """
    client = mongomock.MongoClient()
    monkeypatch.setattr(store, "get_db", lambda: client["testdb"])
    monkeypatch.setattr(store, "_initialized", False)
    yield


def _profil(**extra) -> UserProfile:
    base = {
        "siren": "812345678",
        "denomination": "Studio Nova",
        "registry_address": "14 rue des Lilas, 69003 Lyon",
        "is_entrepreneur_individuel": True,
        "recommended_regime": "micro-BNC",
    }
    base.update(extra)
    return UserProfile(**base)


def _requete(**extra) -> FactureRequest:
    base = {
        "client": ClientFacture(nom="Client SARL", est_professionnel=True,
                                adresse="8 quai Perrache, Lyon", siret="90123456700012"),
        "lignes": [LigneFacture(designation="Prestation vidéo", quantite=2,
                                prix_unitaire_ht=500.0)],
    }
    base.update(extra)
    return FactureRequest(**base)


# -- Brouillon ---------------------------------------------------------------
def test_un_brouillon_ne_consomme_aucun_numero():
    """C'est la garantie anti-trou : abandonner un brouillon ne casse pas la séquence."""
    brouillon = generator.construire_document("u1", _profil(), _requete())

    assert brouillon.statut == "brouillon"
    assert brouillon.numero is None
    assert brouillon.date_emission is None

    # Le compteur n'a pas bougé : la première facture émise prend bien le n° 1.
    assert store.prochain_numero("u1").endswith("-000001")


def test_plusieurs_brouillons_coexistent():
    """L'index unique sur le numéro est PARTIEL : sinon deux brouillons (numero=None)
    entreraient en collision."""
    for _ in range(3):
        store.enregistrer(generator.construire_document("u1", _profil(), _requete()))

    assert len(store.lister("u1")) == 3


def test_un_brouillon_se_supprime_une_facture_emise_non():
    brouillon = generator.construire_document("u1", _profil(), _requete())
    store.enregistrer(brouillon)
    assert store.supprimer_brouillon("u1", brouillon.id) is True

    emise = generator.generer_facture("u1", "FA-2026-000001", _profil(), _requete())
    store.enregistrer(emise)
    assert store.supprimer_brouillon("u1", emise.id) is False, "traçabilité légale"
    assert store.obtenir("u1", emise.id) is not None


def test_supprimer_une_facture_emise_laisse_une_trace_du_numero():
    """Le trou dans la séquence doit rester justifiable : la loi l'interdit, l'utilisateur
    peut l'imposer, mais le numéro disparu doit pouvoir être expliqué."""
    emise = generator.generer_facture("u1", "FA-2026-000001", _profil(), _requete())
    store.enregistrer(emise)

    supprime = store.supprimer_facture("u1", emise.id)

    assert supprime is not None and supprime["numero"] == "FA-2026-000001"
    assert store.obtenir("u1", emise.id) is None, "elle quitte bien la base"
    trace = store.numeros_supprimes("u1")
    assert len(trace) == 1
    assert trace[0]["numero"] == "FA-2026-000001"
    assert trace[0]["statut"] == "emise"
    assert trace[0]["supprime_le"], "la date de suppression est consignée"


def test_supprimer_un_brouillon_ne_laisse_aucune_trace():
    """Un brouillon ne consomme aucun numéro : il n'y a aucun trou à justifier."""
    brouillon = generator.construire_document("u1", _profil(), _requete())
    store.enregistrer(brouillon)

    assert store.supprimer_facture("u1", brouillon.id) is not None
    assert store.numeros_supprimes("u1") == []


def test_supprimer_une_facture_inexistante_ne_trace_rien():
    assert store.supprimer_facture("u1", "id-inconnu") is None
    assert store.numeros_supprimes("u1") == []


def test_la_suppression_ne_touche_pas_les_factures_d_un_autre_utilisateur():
    emise = generator.generer_facture("u1", "FA-2026-000001", _profil(), _requete())
    store.enregistrer(emise)

    assert store.supprimer_facture("u2", emise.id) is None
    assert store.obtenir("u1", emise.id) is not None
    assert store.numeros_supprimes("u2") == []


def test_le_numero_supprime_n_est_jamais_reattribue():
    """Le compteur ne recule pas — un numéro rendu produirait DEUX factures homonymes.

    Un trou justifié vaut mieux qu'un doublon : le premier se documente, le second rend la
    séquence incohérente. Le compteur vit dans sa propre collection, pas dans le maximum des
    factures existantes, ce qui est précisément ce qui le protège d'une suppression.
    """
    numero = store.prochain_numero("u1")  # consomme réellement le compteur
    emise = generator.generer_facture("u1", numero, _profil(), _requete())
    store.enregistrer(emise)
    store.supprimer_facture("u1", emise.id)

    assert numero.endswith("-000001")
    assert store.prochain_numero("u1").endswith("-000002"), "le numéro retiré reste consommé"


def test_la_route_suppressions_n_est_pas_avalee_par_la_route_par_identifiant():
    """`/suppressions` doit être déclaré AVANT `/{facture_id}`, sinon il est lu comme un id.

    FastAPI résout dans l'ordre de déclaration : inverser les deux ferait répondre « facture
    introuvable » à la consultation des suppressions, sans rien casser d'apparent côté serveur.
    """
    from app.api.facture import router

    # Seules les routes GET se disputent ce chemin : une DELETE portant le même motif ne peut
    # pas capturer une requête GET, Starlette départageant aussi sur la méthode.
    gets = [r.path for r in router.routes if "GET" in getattr(r, "methods", set())]
    assert gets.index("/api/facture/suppressions") < gets.index("/api/facture/{facture_id}")


def test_seules_les_emises_ont_une_existence_fiscale():
    store.enregistrer(generator.construire_document("u1", _profil(), _requete()))
    store.enregistrer(generator.generer_facture("u1", "FA-2026-000001", _profil(), _requete()))

    assert len(store.lister("u1")) == 2
    assert len(store.lister_emises("u1")) == 1


# -- Numérotation ------------------------------------------------------------
def test_deux_sequences_distinctes():
    assert store.prochain_numero("u1", "facture").startswith("FA-")
    assert store.prochain_numero("u1", "avoir").startswith("AV-")
    # Chaque séquence a son propre compteur : l'avoir ne consomme pas un numéro de facture.
    assert store.prochain_numero("u1", "facture").endswith("-000002")
    assert store.prochain_numero("u1", "avoir").endswith("-000002")


def test_numerotation_sans_doublon_sous_concurrence():
    """Vingt émissions simultanées : vingt numéros distincts, aucun trou."""
    with ThreadPoolExecutor(max_workers=8) as pool:
        numeros = list(pool.map(lambda _: store.prochain_numero("u1"), range(20)))

    assert len(set(numeros)) == 20, "aucun doublon"
    suffixes = sorted(int(n.rsplit("-", 1)[1]) for n in numeros)
    assert suffixes == list(range(1, 21)), "séquence continue, aucun trou"


def test_les_compteurs_sont_cloisonnes_par_utilisateur():
    store.prochain_numero("u1")
    store.prochain_numero("u1")
    assert store.prochain_numero("u2").endswith("-000001")


# -- Mentions selon la qualité du client -------------------------------------
def test_indemnite_de_recouvrement_absente_face_a_un_particulier():
    """Elle n'est due qu'entre professionnels : l'afficher serait une mention abusive."""
    requete = _requete(client=ClientFacture(nom="Marie Durand", est_professionnel=False,
                                            adresse="3 rue du Port, Lyon"))
    mentions, _ = generator.construire_mentions(_profil(), requete, 1000.0, 0.0)
    cles = {m.cle for m in mentions}

    assert "indemnite_recouvrement" not in cles
    assert "garantie_legale" in cles, "en revanche la garantie légale vise le consommateur"


def test_indemnite_presente_face_a_un_professionnel():
    mentions, _ = generator.construire_mentions(_profil(), _requete(), 1000.0, 0.0)
    cles = {m.cle for m in mentions}

    assert "indemnite_recouvrement" in cles
    assert "garantie_legale" not in cles


def test_le_siret_du_client_professionnel_est_reclame():
    sans_siret = _requete(client=ClientFacture(nom="Client SARL", est_professionnel=True,
                                               adresse="Lyon"))
    assert "SIRET du client professionnel" in generator.champs_manquants(sans_siret)
    # Un particulier n'a pas de SIRET : rien à réclamer.
    particulier = _requete(client=ClientFacture(nom="Marie", est_professionnel=False,
                                                adresse="Lyon"))
    assert generator.champs_manquants(particulier) == []


def test_aucune_mention_n_est_inventee():
    """Chaque mention affichée porte sa source."""
    mentions, _ = generator.construire_mentions(_profil(), _requete(), 1000.0, 0.0)
    assert all(m.source.startswith("http") for m in mentions)


# -- Échéance ----------------------------------------------------------------
def test_echeance_par_defaut_depuis_la_configuration():
    facture = generator.generer_facture("u1", "FA-2026-000001", _profil(), _requete())
    attendu = facture.date_emission + timedelta(days=reglementaire.delai_paiement_defaut())
    assert facture.date_echeance == attendu


def test_echeance_explicite_prioritaire_sur_le_delai():
    echeance = date(2026, 12, 31)
    facture = generator.generer_facture(
        "u1", "FA-2026-000001", _profil(),
        _requete(date_echeance=echeance, delai_paiement_jours=15),
    )
    assert facture.date_echeance == echeance


# -- Remises et acompte ------------------------------------------------------
def test_remise_appliquee_avant_la_tva():
    requete = _requete(lignes=[LigneFacture(designation="Prestation", quantite=1,
                                            prix_unitaire_ht=1000.0, remise_pourcent=10,
                                            taux_tva=0.20)])
    facture = generator.generer_facture("u1", "FA-2026-000001", _profil(), requete)

    assert facture.total_ht == pytest.approx(900.0)
    assert facture.total_tva == pytest.approx(180.0)
    assert facture.total_ttc == pytest.approx(1080.0)


def test_l_acompte_se_deduit_et_reference_sa_facture():
    requete = _requete(acompte=Acompte(montant_ttc=300.0, facture_numero="FA-2026-000001"))
    facture = generator.generer_facture("u1", "FA-2026-000002", _profil(), requete)

    assert facture.total_ttc == pytest.approx(1000.0)
    assert facture.net_a_payer == pytest.approx(700.0), "le solde déduit l'acompte"
    assert facture.acompte.facture_numero == "FA-2026-000001", "traçabilité de la déduction"


def test_sans_acompte_le_net_egale_le_ttc():
    facture = generator.generer_facture("u1", "FA-2026-000001", _profil(), _requete())
    assert facture.net_a_payer == facture.total_ttc


# -- Avoir -------------------------------------------------------------------
def test_l_avoir_porte_des_montants_negatifs_et_reference_l_origine():
    """Signe négatif : les documents se somment directement pour obtenir un CA net."""
    avoir = generator.construire_document(
        "u1", _profil(), _requete(),
        type_document="avoir", numero="AV-2026-000001", statut="emise",
        date_emission=date.today(), facture_origine_numero="FA-2026-000001",
    )

    assert avoir.type_document == "avoir"
    assert avoir.total_ht == pytest.approx(-1000.0)
    assert avoir.net_a_payer == pytest.approx(-1000.0)
    assert avoir.facture_origine_numero == "FA-2026-000001"


def test_une_facture_annulee_reste_archivee():
    facture = generator.generer_facture("u1", "FA-2026-000001", _profil(), _requete())
    store.enregistrer(facture)
    store.marquer("u1", facture.id, {"statut": "annulee", "avoir_numero": "AV-2026-000001"})

    archivee = store.obtenir("u1", facture.id)
    assert archivee is not None, "jamais supprimée : traçabilité légale"
    assert archivee["statut"] == "annulee"
    assert archivee["avoir_numero"] == "AV-2026-000001"
    # Et elle sort du chiffre d'affaires.
    assert store.lister_emises("u1") == []


# -- Régime de TVA : déclaratif, jamais automatique ---------------------------
def test_la_franchise_suit_le_regime_du_profil():
    assert generator.franchise_tva(_profil(recommended_regime="micro-BNC")) is True
    assert generator.franchise_tva(_profil(recommended_regime="réel simplifié")) is False


def test_la_declaration_de_l_utilisateur_fait_autorite():
    """Un micro-entrepreneur ayant franchi le seuil se déclare assujetti : on le suit."""
    profil = _profil(recommended_regime="micro-BNC")
    assert generator.franchise_tva(profil, assujetti_declare=True) is False
    assert generator.franchise_tva(profil, assujetti_declare=False) is True


def test_le_regime_declare_a_l_onboarding_prime_sur_l_heuristique():
    """`recommended_regime` confond régime d'imposition et régime de TVA.

    Un micro-entrepreneur ayant franchi le seuil reste au micro-BIC ET devient assujetti :
    l'heuristique « micro dans le libellé » concluait à tort à la franchise, et la facture
    sortait avec la mention 293 B alors que la TVA était due.
    """
    profil = _profil(recommended_regime="micro-BNC", regime_tva="reel_simplifie")
    assert generator.franchise_tva(profil) is False

    profil_franchise = _profil(recommended_regime="micro-BNC", regime_tva="franchise")
    assert generator.franchise_tva(profil_franchise) is True


def test_sans_regime_declare_l_heuristique_reste_le_repli():
    assert generator.franchise_tva(_profil(recommended_regime="micro-BNC")) is True


def test_le_choix_pour_ce_document_prime_sur_le_profil():
    profil = _profil(regime_tva="franchise")
    assert generator.franchise_tva(profil, assujetti_declare=True) is False


# -- Données d'onboarding effectivement portées sur la facture ----------------
def test_l_iban_et_le_numero_de_tva_du_profil_arrivent_sur_la_facture():
    """Les `getattr` visaient des noms inexistants : ces champs sortaient toujours vides."""
    profil = _profil(
        regime_tva="reel_simplifie",
        invoicing_iban="FR7630001007941234567890185",
        numero_tva_intracommunautaire="FR40812345678",
    )
    facture = generator.generer_facture("u1", "FA-2026-000001", profil, _requete())

    assert facture.emetteur_iban == "FR7630001007941234567890185"
    assert facture.emetteur_tva_intracom == "FR40812345678"


def test_le_numero_de_tva_renseigne_n_est_plus_reclame():
    """Il était signalé manquant même une fois fourni, à cause du mauvais nom de champ."""
    profil = _profil(
        regime_tva="reel_simplifie", numero_tva_intracommunautaire="FR40812345678",
    )
    grosse = _requete(lignes=[LigneFacture(designation="Gros lot", quantite=1,
                                           prix_unitaire_ht=5000.0)])
    manquants = generator.champs_manquants(grosse, profil)
    assert not [m for m in manquants if "intracommunautaire" in m]


def test_le_numero_de_tva_absent_est_bien_reclame_au_dela_du_seuil():
    profil = _profil(regime_tva="reel_simplifie")
    grosse = _requete(lignes=[LigneFacture(designation="Gros lot", quantite=1,
                                           prix_unitaire_ht=5000.0)])
    manquants = generator.champs_manquants(grosse, profil)
    assert [m for m in manquants if "intracommunautaire" in m]


def test_le_numero_rcs_n_est_pas_imprime_comme_police_d_assurance():
    """`rcs_rm_number` est une immatriculation, `emetteur_rc_pro` un n° de police.

    Les confondre imprimerait sur la facture un numéro qui n'est pas celui attendu.
    """
    profil = _profil(rcs_rm_number="RCS Lyon 812 345 678")
    facture = generator.generer_facture("u1", "FA-2026-000001", profil, _requete())
    assert facture.emetteur_rc_pro is None


def test_la_mention_de_franchise_est_exactement_celle_du_cgi():
    mentions, _ = generator.construire_mentions(_profil(), _requete(), 1000.0, 0.0)
    franchise = next(m for m in mentions if m.cle == "franchise_tva")
    assert franchise.valeur == "TVA non applicable, art. 293 B du code général des impôts"


def test_bascule_franchise_vers_assujetti_sans_effet_retroactif():
    """Les factures déjà émises gardent leur mention : rien n'est recalculé."""
    profil = _profil()
    avant = generator.generer_facture("u1", "FA-2026-000001", profil, _requete())
    store.enregistrer(avant)

    # Franchissement déclaré : les factures suivantes portent la TVA.
    apres = generator.construire_document(
        "u1", profil,
        _requete(lignes=[LigneFacture(designation="Prestation", prix_unitaire_ht=1000.0,
                                      taux_tva=0.20)]),
        numero="FA-2026-000002", statut="emise", date_emission=date.today(),
        en_franchise=False,
    )

    assert avant.emetteur_franchise_tva is True
    assert apres.emetteur_franchise_tva is False
    assert apres.total_tva == pytest.approx(200.0)
    # La facture d'origine est inchangée en base.
    assert store.obtenir("u1", avant.id)["emetteur_franchise_tva"] is True


@pytest.mark.parametrize(
    "ca,niveau_attendu",
    [(1000.0, None), (35000.0, "proche"), (40000.0, "depasse_base"), (50000.0, "depasse_majore")],
)
def test_alerte_de_seuil_sans_jamais_decider(ca, niveau_attendu):
    alerte = generator.alerte_seuil_tva(ca, "services")
    if niveau_attendu is None:
        assert alerte is None
    else:
        assert alerte["niveau"] == niveau_attendu
        # La note doit rappeler que le seuil porte sur l'ENCAISSÉ, pas sur le facturé.
        assert "encaiss" in alerte["note"].lower()


# -- Valeurs réglementaires --------------------------------------------------
def test_les_montants_reglementaires_viennent_du_fichier_de_donnees():
    assert "40 €" in reglementaire.indemnite_recouvrement_mention()
    assert reglementaire.seuil_dispense_tva_intracom() == 150.0
    assert reglementaire.indemnite_due_aux_particuliers() is False


def test_les_valeurs_a_verifier_sont_signalees():
    """Un humain doit savoir où brancher une source live."""
    provenance = reglementaire.provenance()
    assert "indemnite_recouvrement" in provenance["a_verifier_en_direct"]
    assert "tva_intracommunautaire" in provenance["a_verifier_en_direct"]
    assert provenance["date_verif"]


def test_seuil_tva_intracom_declenche_au_dela_de_150_euros():
    _, requise_petite = generator.construire_mentions(_profil(), _requete(), 150.0, 0.0)
    _, requise_grande = generator.construire_mentions(_profil(), _requete(), 150.01, 0.0)
    assert requise_petite is False
    assert requise_grande is True


# -- Rendu PDF ---------------------------------------------------------------
# -- Défauts constatés sur une facture réelle --------------------------------
def test_une_facture_dit_toujours_quelque_chose_de_la_tva():
    """Régime non qualifié : le document doit le SIGNALER, pas rester muet.

    Auparavant, un profil sans régime tombait dans « assujetti » et la facture ne portait
    aucune mention de TVA — ni l'article 293 B, ni un taux. Document non conforme.
    """
    profil_sans_regime = _profil(recommended_regime=None)
    assert generator.franchise_tva(profil_sans_regime) is None

    mentions, _ = generator.construire_mentions(profil_sans_regime, _requete(), 1000.0, 0.0)
    cles = {m.cle for m in mentions}
    assert cles & {"regime_tva_indetermine", "franchise_tva", "autoliquidation", "tva_absente"}, \
        "aucune mention de TVA : la facture serait non conforme"
    assert "regime_tva_indetermine" in cles


def test_le_regime_indetermine_remonte_dans_les_champs_manquants():
    manquants = generator.champs_manquants(_requete(), _profil(recommended_regime=None))
    assert any("régime de TVA" in m for m in manquants)


def test_assujetti_sans_tva_facturee_est_signale():
    """Assujetti mais aucun taux saisi : l'incohérence doit se voir sur le document."""
    mentions, _ = generator.construire_mentions(
        _profil(recommended_regime="réel simplifié"), _requete(), 1000.0, 0.0,
    )
    assert "tva_absente" in {m.cle for m in mentions}


def test_le_numero_de_tva_du_vendeur_est_reclame_au_dela_du_seuil():
    """Il était imprimé « requis » sans valeur : mieux vaut le demander à la saisie."""
    grosse = _requete(lignes=[LigneFacture(designation="Prestation", prix_unitaire_ht=1000.0)])
    assert any("TVA intracommunautaire du vendeur" in m
               for m in generator.champs_manquants(grosse, _profil()))
    petite = _requete(lignes=[LigneFacture(designation="Prestation", prix_unitaire_ht=100.0)])
    assert not any("TVA intracommunautaire du vendeur" in m
                   for m in generator.champs_manquants(petite, _profil()))


def test_le_total_de_ligne_du_pdf_tient_compte_de_la_remise():
    """Le tableau affichait le brut pendant que le total appliquait la remise :
    le document se contredisait."""
    from app.agents.facture import pdf as pdf_mod

    ligne = LigneFacture(designation="Sponso", quantite=1.02, prix_unitaire_ht=1000.0,
                         remise_pourcent=3)
    facture = generator.generer_facture("u1", "FA-2026-000001", _profil(), _requete(lignes=[ligne]))

    # Ce que le générateur retient…
    assert facture.total_ht == pytest.approx(989.40)
    # …et ce que le PDF calcule pour la même ligne, désormais identiques.
    remise = ligne.remise_pourcent or 0.0
    ht_pdf = round(ligne.quantite * ligne.prix_unitaire_ht * (1 - remise / 100), 2)
    assert ht_pdf == pytest.approx(facture.total_ht)
    assert pdf_mod.facture_to_pdf(facture).startswith(b"%PDF")


def test_le_symbole_euro_survit_au_repli_sans_police_unicode():
    """Sans police Unicode, « € » devenait « ? ». Il doit devenir « EUR »."""
    from app.agents.facture.pdf import _eur

    assert "€" in _eur(1000.0, unicode_ok=True)
    rendu = _eur(1000.0, unicode_ok=False)
    assert "EUR" in rendu and "?" not in rendu


def test_le_pdf_se_genere_pour_un_brouillon_sans_numero():
    """Un brouillon n'a ni numéro ni date : le rendu ne doit pas planter pour autant."""
    brouillon = generator.construire_document("u1", _profil(), _requete())
    pdf = facture_to_pdf(brouillon)
    assert pdf.startswith(b"%PDF")


def test_le_pdf_se_genere_avec_acompte_avoir_et_iban():
    facture = generator.generer_facture(
        "u1", "FA-2026-000002", _profil(),
        _requete(acompte=Acompte(montant_ttc=300.0, facture_numero="FA-2026-000001"),
                 numero_contrat="CT-2026-7", mode_paiement="virement"),
    )
    assert facture_to_pdf(facture).startswith(b"%PDF")

    avoir = generator.construire_document(
        "u1", _profil(), _requete(), type_document="avoir", numero="AV-2026-000001",
        statut="emise", date_emission=date.today(), facture_origine_numero="FA-2026-000002",
    )
    assert facture_to_pdf(avoir).startswith(b"%PDF")
