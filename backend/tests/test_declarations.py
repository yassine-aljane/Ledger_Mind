"""Agent déclaratif — les cinq déclarations, selon la spécification officielle.

L'exemple chiffré de la spécification (§4, « Léa ») sert de référence bout en bout : 1 100 €
encaissés en BIC services, 2ᵉ année, versement libératoire, franchise de TVA, plus de l'AdSense
irlandais. Total attendu : 255,68 €.

Quatre interdits structurants sont vérifiés ici, parce que les enfreindre produirait une
déclaration fausse sans que rien ne le signale :

  1. **l'abattement n'est jamais déduit** avant de remplir une case — l'administration
     l'applique, le déduire ici le compterait deux fois ;
  2. **aucun numéro de case n'est inventé** — le CA3 n'étant pas recoupé, ses champs sortent
     marqués « à vérifier » ;
  3. **les trois lignes de CA restent séparées** — trois natures, trois taux ;
  4. **la déclaration à 0 € reste due** — l'omettre coûte une pénalité alors que rien n'est dû.
"""

from __future__ import annotations

from typing import Any, Dict, List

import mongomock
import pytest

from app.agents.declarations import generateur as G
from app.agents.declarations import revenus_ue as UE
from app.agents.declarations import sources as pieces_decl
from app.agents.declarations import store
from app.agents.declarations.contexte import (
    contexte_depuis_profil,
    informations_manquantes,
)
from app.agents.declarations.calendrier import calendrier, echeances_urssaf, prochaine
from app.agents.declarations.pdf import brouillon_to_pdf, jeu_to_pdf
from app.agents.declarations.schemas import ContexteDeclaratif, DemandeDeclarations
from app.agents.impots import tools as moteur
from app.schemas.orchestrator import UserProfile

UID = "u1"
_FACTURES: List[Dict[str, Any]] = []
_VIREMENTS: List[Dict[str, Any]] = []


@pytest.fixture(autouse=True)
def sources(monkeypatch):
    """`generateur` importe ses dépendances par `from … import` : le nom est lié dans CE
    module, c'est donc lui qu'il faut patcher, pas la source."""
    _FACTURES.clear()
    _VIREMENTS.clear()
    monkeypatch.setattr(G.facture_store, "lister_emises", lambda uid: _FACTURES)
    monkeypatch.setattr(G.pieces, "virements", lambda uid: _VIREMENTS)
    client = mongomock.MongoClient()
    db = client["testdb"]
    monkeypatch.setattr(store, "get_db", lambda: db)
    monkeypatch.setattr(store, "_initialized", False)
    # `sources` lit la base directement : sans ce patch, les tests taperaient la VRAIE base.
    monkeypatch.setattr(pieces_decl, "get_db", lambda: db)
    yield db


def _facture(numero: str, net: float, categorie: str = "prestation",
             emission: str = "2026-08-01"):
    _FACTURES.append({
        "id": f"id-{numero}", "numero": numero, "net_a_payer": net,
        "total_ht": net, "total_ttc": net, "date_emission": emission,
        "date_echeance": "2026-08-31", "client": {"nom": "Client"},
        "lignes": [{"designation": "x", "quantite": 1, "prix_unitaire_ht": net,
                    "categorie": categorie}],
    })


def _virement(doc_id: str, montant: float, motif: str, iban: str = "FR7630004008280001234567891",
              nom: str = "Client", date_iso: str = "2026-08-10", direction: str = "recu"):
    _VIREMENTS.append({
        "user_id": UID, "document_id": doc_id,
        "transfer": {"amount": montant, "amount_eur": montant, "direction": direction,
                     "execution_date": date_iso, "motif": motif,
                     "sender_name": nom, "sender_iban": iban},
    })


def _generer(contexte=None, debut="2026-08-01", fin="2026-08-31", profil=None):
    return G.generer_declarations(
        UID,
        DemandeDeclarations(date_debut=debut, date_fin=fin,
                            contexte=contexte or ContexteDeclaratif(), enregistrer=False),
        profil=profil,
    )


def _brouillon(jeu, type_):
    return next(b for b in jeu.brouillons if b.type == type_)


# -- L'exemple chiffré de la spécification -----------------------------------
def test_l_exemple_de_la_specification_est_reproduit_au_centime():
    _facture("FA-2026-000001", 800.0)
    _facture("FA-2026-000002", 300.0)
    _virement("v1", 800.0, "FA-2026-000001")
    _virement("v2", 300.0, "FA-2026-000002")

    jeu = _generer(ContexteDeclaratif(
        frequence="mensuelle", categorie_par_defaut="BIC_SERVICE",
        option_versement_liberatoire=True, date_creation="2024-03-01",
    ))
    p = jeu.prelevements

    assert jeu.ca_encaisse == 1100.0
    assert p["cotisations_sociales"] == 233.20
    assert p["cfp"] == 3.30
    assert p["tfcc"] == 0.48
    assert p["versement_liberatoire"] == 18.70
    assert p["total_a_payer"] == 255.68


# -- §1 L'abattement n'est JAMAIS déduit avant de remplir une case -----------
def test_la_case_de_revenus_porte_le_ca_brut_jamais_abattu():
    """L'administration applique l'abattement : le déduire ici le compterait deux fois."""
    _facture("FA-2026-000001", 20000.0)
    _virement("v1", 20000.0, "FA-2026-000001")

    champ = _brouillon(_generer(ContexteDeclaratif(categorie_par_defaut="BNC")),
                       "revenus_2042").champs[0]

    assert champ.valeur == 20000.0, "34 % d'abattement NE doivent PAS être déduits"
    assert "brut" in champ.note.lower()


@pytest.mark.parametrize("categorie,case", [
    ("BIC_VENTE", "5KO"), ("BIC_SERVICE", "5KP"), ("BNC", "5HQ"),
])
def test_chaque_categorie_a_sa_case_officielle(categorie, case):
    nature = "vente" if categorie == "BIC_VENTE" else "prestation"
    _facture("FA-2026-000001", 5000.0, categorie=nature)
    _virement("v1", 5000.0, "FA-2026-000001")

    champs = _brouillon(_generer(ContexteDeclaratif(categorie_par_defaut=categorie)),
                        "revenus_2042").champs
    assert champs[0].case == case


def test_l_activite_mixte_remplit_deux_cases_distinctes():
    _facture("FA-2026-000001", 12000.0, categorie="vente")
    _facture("FA-2026-000002", 8000.0, categorie="prestation")
    _virement("v1", 12000.0, "FA-2026-000001")
    _virement("v2", 8000.0, "FA-2026-000002")

    champs = _brouillon(_generer(ContexteDeclaratif(categorie_par_defaut="BNC")),
                        "revenus_2042").champs
    assert {c.case for c in champs} == {"5KO", "5HQ"}
    assert {c.valeur for c in champs} == {12000.0, 8000.0}


# -- §3 Les trois lignes de CA restent séparées ------------------------------
def test_les_trois_lignes_de_ca_urssaf_sont_toujours_presentes():
    """Le téléservice les demande séparément : une case vide n'a pas le sens d'un 0."""
    _facture("FA-2026-000001", 1000.0)
    _virement("v1", 1000.0, "FA-2026-000001")

    champs = _brouillon(_generer(ContexteDeclaratif(categorie_par_defaut="BNC")),
                        "ca_urssaf").champs
    lignes = [c for c in champs if c.libelle.startswith("Chiffre d'affaires")]

    assert len(lignes) == 3, "vente, BIC services et BNC — jamais fusionnées"
    assert [c.valeur for c in lignes] == [0.0, 0.0, 1000.0]


def test_les_natures_ne_sont_jamais_fusionnees_en_activite_mixte():
    _facture("FA-2026-000001", 12000.0, categorie="vente")
    _facture("FA-2026-000002", 8000.0, categorie="prestation")
    _virement("v1", 12000.0, "FA-2026-000001")
    _virement("v2", 8000.0, "FA-2026-000002")

    jeu = _generer(ContexteDeclaratif(categorie_par_defaut="BNC"))
    assert jeu.ca_par_categorie == {"BIC_VENTE": 12000.0, "BNC": 8000.0}
    assert {p["categorie"] for p in jeu.prelevements["postes"]} == {"BIC_VENTE", "BNC"}


# -- §4 La déclaration à 0 € reste obligatoire -------------------------------
def test_la_declaration_a_zero_reste_due_et_le_dit():
    jeu = _generer()
    brouillon = _brouillon(jeu, "ca_urssaf")

    assert brouillon.applicable is True, "aucun CA n'est PAS une dispense"
    assert brouillon.montant_a_payer == 0.0
    assert any("obligatoire" in v.lower() for v in brouillon.points_de_vigilance)


# -- TFCC : BIC seulement ----------------------------------------------------
def test_la_tfcc_ne_s_applique_pas_au_bnc():
    """Un BNC n'est inscrit qu'au RNE, jamais au RCS : la taxe consulaire ne le vise pas."""
    _facture("FA-2026-000001", 10000.0)
    _virement("v1", 10000.0, "FA-2026-000001")

    jeu = _generer(ContexteDeclaratif(categorie_par_defaut="BNC"))
    assert jeu.prelevements["tfcc"] == 0.0
    assert jeu.prelevements["postes"][0]["tfcc_applicable"] is False


def test_la_tfcc_s_applique_au_bic():
    _facture("FA-2026-000001", 10000.0)
    _virement("v1", 10000.0, "FA-2026-000001")

    jeu = _generer(ContexteDeclaratif(categorie_par_defaut="BIC_SERVICE"))
    assert jeu.prelevements["tfcc"] > 0


def test_le_taux_tfcc_non_recoupe_est_signale():
    """La spécification l'exige : une valeur non vérifiée ne se présente pas comme fiable."""
    _facture("FA-2026-000001", 10000.0)
    _virement("v1", 10000.0, "FA-2026-000001")

    brouillon = _brouillon(_generer(ContexteDeclaratif(categorie_par_defaut="BIC_SERVICE")),
                           "ca_urssaf")
    assert any("NON recoupée" in v for v in brouillon.points_de_vigilance)


# -- CFP : exonération première année ----------------------------------------
def test_la_cfp_est_exoneree_la_premiere_annee_sous_le_seuil():
    _facture("FA-2026-000001", 4000.0)
    _virement("v1", 4000.0, "FA-2026-000001")

    jeu = _generer(ContexteDeclaratif(categorie_par_defaut="BNC", date_creation="2026-01-10"))
    assert jeu.prelevements["cfp"] == 0.0
    assert jeu.prelevements["cfp_exoneree"] is True


def test_la_cfp_est_due_des_que_le_seuil_est_franchi():
    """Les DEUX conditions à la fois : première année ET CA sous le seuil."""
    _facture("FA-2026-000001", 9000.0)
    _virement("v1", 9000.0, "FA-2026-000001")

    jeu = _generer(ContexteDeclaratif(categorie_par_defaut="BNC", date_creation="2026-01-10"))
    assert jeu.prelevements["cfp"] > 0
    assert jeu.prelevements["cfp_exoneree"] is False


def test_la_cfp_est_due_en_deuxieme_annee_meme_a_petit_ca():
    _facture("FA-2026-000001", 1000.0)
    _virement("v1", 1000.0, "FA-2026-000001")

    jeu = _generer(ContexteDeclaratif(categorie_par_defaut="BNC", date_creation="2023-01-10"))
    assert jeu.prelevements["cfp"] > 0


# -- DES : le piège des plateformes européennes ------------------------------
def test_un_encaissement_avec_iban_europeen_declenche_la_des():
    """L'obligation existe MÊME sous franchise de TVA nationale."""
    _facture("FA-2026-000001", 300.0)
    _virement("v1", 300.0, "FA-2026-000001", iban="IE29AIBK93115212345678",
              nom="Google Ireland Ltd")

    jeu = _generer()
    assert len(jeu.revenus_ue) == 1
    assert jeu.revenus_ue[0].certain is True, "un IBAN est une donnée structurée"
    assert jeu.revenus_ue[0].pays == "IE"
    assert _brouillon(jeu, "des").applicable is True


def test_un_iban_francais_ne_declenche_jamais_la_des():
    _facture("FA-2026-000001", 900.0)
    _virement("v1", 900.0, "FA-2026-000001", iban="FR7630004008280001234567891")

    jeu = _generer()
    assert jeu.revenus_ue == []
    assert _brouillon(jeu, "des").applicable is False


def test_un_libelle_evocateur_est_un_indice_pas_une_preuve():
    """« Google » dans un motif ne prouve pas que le payeur est établi en Irlande."""
    _facture("FA-2026-000001", 300.0)
    _virement("v1", 300.0, "adsense google", iban=None, nom="Paiement adsense")

    jeu = _generer()
    assert len(jeu.revenus_ue) == 1
    assert jeu.revenus_ue[0].certain is False
    champ = next(c for c in _brouillon(jeu, "des").champs if "Preneur" in c.libelle)
    assert champ.fiabilite == "a_verifier"


def test_un_virement_sortant_ne_declenche_pas_la_des():
    """La DES porte sur les services FOURNIS : un paiement sortant n'en est pas un."""
    _virement("v1", 300.0, "achat", iban="IE29AIBK93115212345678", direction="emis")
    assert _generer().revenus_ue == []


def test_l_absence_de_numero_de_tva_intracom_est_prioritaire():
    """La démarche précède la perception : certaines plateformes ne paient pas sans."""
    _facture("FA-2026-000001", 300.0)
    _virement("v1", 300.0, "FA-2026-000001", iban="IE29AIBK93115212345678")

    rappels = _generer().rappels
    prioritaire = next(r for r in rappels if r.priorite == "haute" and "TVA" in r.titre)
    assert "gratuite" in prioritaire.message


def test_la_des_ne_donne_lieu_a_aucun_paiement():
    _facture("FA-2026-000001", 300.0)
    _virement("v1", 300.0, "FA-2026-000001", iban="IE29AIBK93115212345678")

    brouillon = _brouillon(_generer(), "des")
    assert brouillon.montant_a_payer is None
    assert any("AUCUN paiement" in v for v in brouillon.points_de_vigilance)


@pytest.mark.parametrize("iban,attendu", [
    ("IE29AIBK93115212345678", "IE"),
    ("DE89370400440532013000", "DE"),
    ("FR7630004008280001234567891", "FR"),
    (None, None),
    ("", None),
])
def test_le_pays_se_lit_dans_le_prefixe_de_l_iban(iban, attendu):
    assert UE.pays_depuis_iban(iban) == attendu


# -- §2 Aucun numéro de case n'est inventé -----------------------------------
def test_le_ca3_ne_pretend_a_aucun_numero_de_case():
    """Les références du CA3 n'ont pas été recoupées : la structure, jamais des numéros."""
    brouillon = _brouillon(_generer(ContexteDeclaratif(assujetti_tva=True)), "tva_ca3")

    assert brouillon.applicable is True
    assert all(c.case is None for c in brouillon.champs), "aucun numéro inventé"
    assert all(c.fiabilite == "a_verifier" for c in brouillon.champs)
    assert any("n'ont pas été recoupés" in v for v in brouillon.points_de_vigilance)


def test_la_tva_est_chiffree_depuis_les_pieces_reelles():
    """Le guide demande collectée / déductible / nette — chiffrées, pas laissées vides.

    Ce sont les NUMÉROS DE CASE qui restent inconnus, pas les montants : chaque ligne sort
    donc avec sa valeur et une fiabilité « à vérifier ».
    """
    brouillon = _brouillon(_generer(ContexteDeclaratif(assujetti_tva=True)), "tva_ca3")
    libelles = [c.libelle for c in brouillon.champs]

    assert any("collectée" in l for l in libelles)
    assert any("déductible" in l for l in libelles)
    assert any("nette" in l for l in libelles)
    assert all(c.valeur is not None for c in brouillon.champs), "les montants sont établis"
    assert all(c.fiabilite == "a_verifier" for c in brouillon.champs), "les cases, non"


def test_la_tva_collectee_vient_des_factures_emises():
    _FACTURES.append({
        "id": "f1", "numero": "FA-2026-000001", "net_a_payer": 1200.0,
        "total_ht": 1000.0, "total_ttc": 1200.0, "total_tva": 200.0,
        "date_emission": "2026-08-05", "date_echeance": "2026-09-05",
        "client": {"nom": "Client"}, "lignes": [],
    })
    jeu = _generer(ContexteDeclaratif(assujetti_tva=True))

    assert jeu.tva_collectee["total"] == 200.0
    assert jeu.tva_collectee["base_ht"] == 1000.0


def test_une_tva_illisible_n_est_pas_une_tva_nulle(sources):
    """Compter 0 sur une pièce non lue minorerait la déduction sans le dire."""
    sources["invoices"].insert_one({
        "user_id": UID, "document_id": "d1", "expense_category": "materiel",
        "invoice": {"issuer_name": "X", "issue_date": "2026-08-05",
                    "total_ttc": 120.0, "vat_amount": None},
    })
    jeu = _generer(ContexteDeclaratif(assujetti_tva=True))
    brouillon = _brouillon(jeu, "tva_ca3")

    assert jeu.tva_deductible["pieces_sans_tva_lue"] == 1
    assert jeu.tva_deductible["total"] == 0.0
    assert any("illisible" in v or "lisible" in v for v in brouillon.points_de_vigilance)


def test_la_deduction_rappelle_qu_elle_suppose_un_achat_professionnel():
    brouillon = _brouillon(_generer(ContexteDeclaratif(assujetti_tva=True)), "tva_ca3")
    assert any("PROFESSIONNELS" in v for v in brouillon.points_de_vigilance)


def test_sous_franchise_aucune_declaration_de_tva():
    brouillon = _brouillon(_generer(ContexteDeclaratif(assujetti_tva=False)), "tva_ca3")
    assert brouillon.applicable is False
    assert "franchise" in brouillon.motif_non_applicable


# -- CFE ---------------------------------------------------------------------
def test_la_cfe_est_exoneree_la_premiere_annee():
    brouillon = _brouillon(_generer(ContexteDeclaratif(date_creation="2026-02-01")), "cfe")
    assert brouillon.applicable is False
    assert "exonéré" in brouillon.motif_non_applicable


def test_la_cfe_n_annonce_jamais_de_montant():
    """Le barème est voté commune par commune : l'annoncer serait l'inventer."""
    brouillon = _brouillon(_generer(ContexteDeclaratif(date_creation="2020-02-01")), "cfe")
    assert brouillon.applicable is True
    assert brouillon.montant_a_payer is None
    montant = next(c for c in brouillon.champs if c.libelle == "Montant de la CFE")
    assert montant.valeur is None, "le barème communal ne se devine pas"
    assert any("communal" in v for v in brouillon.points_de_vigilance)


def test_la_cfe_expose_les_trois_donnees_du_bareme():
    """Le guide les nomme : année d'activité, commune, tranche de CA."""
    _facture("FA-2026-000001", 9000.0)
    _virement("v1", 9000.0, "FA-2026-000001")

    champs = _brouillon(
        _generer(ContexteDeclaratif(date_creation="2020-02-01")), "cfe"
    ).champs
    libelles = [c.libelle for c in champs]

    assert "Année d'activité" in libelles
    assert "Commune d'implantation" in libelles
    assert any("Chiffre d'affaires annuel" in l for l in libelles)


# -- L'assiette reste l'encaissé ---------------------------------------------
def test_une_facture_non_encaissee_n_entre_dans_aucune_declaration():
    _facture("FA-2026-000001", 5000.0)  # émise, jamais payée
    jeu = _generer()

    assert jeu.ca_encaisse == 0.0
    assert jeu.prelevements["total_a_payer"] == 0.0


def test_un_virement_sortant_n_entre_pas_dans_l_assiette():
    _facture("FA-2026-000001", 5000.0)
    _virement("v1", 5000.0, "FA-2026-000001", direction="emis")
    assert _generer().ca_encaisse == 0.0


# -- Aucun calcul propre : le moteur fait foi --------------------------------
def test_les_montants_sont_ceux_du_moteur_sans_recalcul():
    """Deux implémentations du même calcul divergeraient : il ne doit y en avoir qu'une."""
    _facture("FA-2026-000001", 33000.0)
    _virement("v1", 33000.0, "FA-2026-000001")

    jeu = _generer(ContexteDeclaratif(categorie_par_defaut="BNC", date_creation="2020-01-01"))
    attendu = moteur.calculer_prelevements_periode(
        [{"categorie": "BNC", "ca": 33000.0}], premiere_annee=False,
    )
    for champ in ("cotisations_sociales", "cfp", "tfcc", "total_a_payer"):
        assert jeu.prelevements[champ] == attendu[champ]


def test_le_jeu_porte_la_provenance_des_taux():
    jeu = _generer()
    assert jeu.provenance.get("declarations", {}).get("fichier") == "data/declarations.yaml"
    assert jeu.provenance["declarations"]["tfcc_verifie"] is False


def test_aucun_endpoint_ne_transmet():
    """Il n'existe aucune route de transmission, et c'est délibéré."""
    from app.api.declarations import router

    chemins = " ".join(r.path for r in router.routes).lower()
    assert "transmettre" not in chemins and "envoyer" not in chemins
    assert "TRANSMISE" in _generer().avertissement


# -- Préremplissage depuis l'onboarding --------------------------------------
def test_le_contexte_est_prerempli_depuis_le_profil():
    profil = UserProfile(
        periodicite_urssaf="mensuelle", fiscal_category="BIC_SERVICE", bnc_caisse="CIPAV",
        acre_active=True, versement_liberatoire=True, regime_tva="reel_simplifie",
        numero_tva_intracommunautaire="FR40812345678", activity_start_date="2024-03-01",
        registry_address="14 rue des Lilas, 69003 Lyon",
    )
    ctx = contexte_depuis_profil(profil)

    assert ctx.frequence == "mensuelle"
    assert ctx.categorie_par_defaut == "BIC_SERVICE"
    assert ctx.caisse_bnc == "CIPAV"
    assert ctx.acre_active is True
    assert ctx.assujetti_tva is True
    assert ctx.numero_tva_intracom == "FR40812345678"
    assert ctx.departement == "69"


def test_la_franchise_de_tva_n_est_pas_un_assujettissement():
    profil = UserProfile(regime_tva="franchise")
    assert contexte_depuis_profil(profil).assujetti_tva is False


def test_les_informations_manquantes_disent_ce_qu_elles_coutent():
    manquants = informations_manquantes(UserProfile())
    champs = {m["champ"] for m in manquants}

    assert "activity_start_date" in champs
    assert "numero_tva_intracommunautaire" in champs
    assert all(m["consequence"] for m in manquants)


def test_un_profil_complet_ne_manque_de_rien():
    profil = UserProfile(
        periodicite_urssaf="trimestrielle", fiscal_category="BNC",
        regime_tva="franchise", numero_tva_intracommunautaire="FR40812345678",
        activity_start_date="2024-03-01",
    )
    assert informations_manquantes(profil) == []


# -- Archivage ---------------------------------------------------------------
def test_un_jeu_enregistre_se_relit():
    _facture("FA-2026-000001", 1000.0)
    _virement("v1", 1000.0, "FA-2026-000001")

    jeu = _generer()
    store.enregistrer(jeu)

    relu = store.obtenir(UID, jeu.id)
    assert relu is not None and relu["ca_encaisse"] == 1000.0
    assert store.supprimer(UID, jeu.id) is True
    assert store.lister(UID) == []


def test_les_jeux_d_un_autre_utilisateur_sont_invisibles():
    store.enregistrer(_generer())
    assert store.lister("quelqu-un-d-autre") == []


# -- Le calendrier : les périodes sont IMPOSÉES, jamais choisies ---------------
def test_le_trimestriel_produit_quatre_echeances_urssaf():
    """Périodes fixées par la réglementation : T1..T4, avec leurs dates limites propres."""
    from datetime import date as _d

    ech = echeances_urssaf(2026, "trimestrielle")
    assert [e.libelle_periode for e in ech] == ["T1 2026", "T2 2026", "T3 2026", "T4 2026"]
    assert ech[0].date_limite == _d(2026, 4, 30)
    # Le T4 se déclare en janvier de l'ANNÉE SUIVANTE.
    assert ech[3].date_limite == _d(2027, 1, 31)


def test_le_mensuel_produit_douze_echeances():
    from datetime import date as _d

    ech = echeances_urssaf(2026, "mensuelle")
    assert len(ech) == 12
    # Un mois se déclare avant la fin du mois SUIVANT.
    assert ech[0].date_limite == _d(2026, 2, 28)
    assert ech[11].date_limite == _d(2027, 1, 31)


def test_toutes_les_echeances_urssaf_sont_dues_meme_a_zero():
    assert all(e.obligatoire_meme_a_zero for e in echeances_urssaf(2026, "trimestrielle"))


def test_la_des_n_apparait_que_les_mois_a_revenu_europeen():
    """Pas de DES « à zéro » : sans prestation intracommunautaire, rien à déclarer."""
    from datetime import date as _d

    avec = [e for e in calendrier(2026, mois_avec_revenu_ue={3, 8}) if e.type == "des"]
    sans = [e for e in calendrier(2026) if e.type == "des"]

    assert [e.libelle_periode for e in avec] == ["mars 2026", "août 2026"]
    assert sans == []


def test_la_cfe_disparait_l_annee_de_creation():
    from datetime import date as _d

    premiere = [e for e in calendrier(2026, date_creation=_d(2026, 2, 1)) if e.type == "cfe"]
    ensuite = [e for e in calendrier(2026, date_creation=_d(2024, 2, 1)) if e.type == "cfe"]

    assert premiere == []
    assert len(ensuite) == 1 and ensuite[0].date_limite == _d(2026, 12, 15)


def test_sous_franchise_aucune_echeance_de_tva():
    assert [e for e in calendrier(2026, regime_tva=None) if e.type == "tva_ca3"] == []
    assert [e for e in calendrier(2026, regime_tva="reel_normal") if e.type == "tva_ca3"]


def test_une_fenetre_officielle_n_est_jamais_convertie_en_date():
    """« mai-juin selon le département » reste une fenêtre : en faire une date l'inventerait."""
    annuelle = next(e for e in calendrier(2026) if e.type == "revenus_2042")
    assert annuelle.date_limite is None
    assert "mai-juin" in annuelle.fenetre_indicative


def test_le_statut_distingue_periode_en_cours_et_retard():
    from datetime import date as _d

    ech = echeances_urssaf(2026, "trimestrielle")
    assert ech[0].statut(_d(2026, 2, 15)) == "periode_en_cours"
    assert ech[0].statut(_d(2026, 4, 15)) == "a_faire"
    assert ech[0].statut(_d(2026, 6, 1)) == "en_retard"


def test_la_prochaine_est_la_plus_ancienne_encore_due():
    from datetime import date as _d

    liste = calendrier(2026, frequence="trimestrielle", date_creation=_d(2024, 1, 1))
    p = prochaine(liste, _d(2026, 8, 4))
    assert p is not None and p.statut(_d(2026, 8, 4)) in ("a_faire", "en_retard")


# -- Le document signable -----------------------------------------------------
def test_le_document_porte_un_bloc_de_signature():
    _facture("FA-2026-000001", 800.0)
    _virement("v1", 800.0, "FA-2026-000001")

    jeu = _generer(ContexteDeclaratif(categorie_par_defaut="BIC_SERVICE",
                                      date_creation="2024-03-01"))
    urssaf = _brouillon(jeu, "ca_urssaf")
    pdf = brouillon_to_pdf(urssaf, jeu, {"denomination": "STUDIO NOVA", "siren": "812345678"})
    assert pdf[:4] == b"%PDF"


def test_le_dossier_reunit_les_declarations_applicables():
    _facture("FA-2026-000001", 800.0)
    _virement("v1", 800.0, "FA-2026-000001")
    assert jeu_to_pdf(_generer(), {"denomination": "X", "siren": "1"})[:4] == b"%PDF"


def test_une_declaration_non_applicable_se_rend_quand_meme():
    """Le document doit expliquer POURQUOI elle ne s'applique pas, pas disparaître."""
    jeu = _generer(ContexteDeclaratif(assujetti_tva=False))
    tva = _brouillon(jeu, "tva_ca3")
    assert tva.applicable is False
    assert brouillon_to_pdf(tva, jeu, {})[:4] == b"%PDF"


# -- Une période vide doit être EXPLIQUÉE, pas juste affichée à zéro ----------
def test_une_periode_vide_dit_ou_se_trouve_le_chiffre_d_affaires():
    """Un « 0 € » sans explication se lit comme une panne.

    Cas réel : l'utilisateur ouvre sur le T1 (le plus ancien encore dû), vide, alors que son
    unique encaissement est daté d'août. Le rapport doit le dire.
    """
    _facture("FA-2026-000001", 2400.0, emission="2026-08-01")
    _virement("v1", 2400.0, "FA-2026-000001", date_iso="2026-08-04")

    t1 = _generer(debut="2026-01-01", fin="2026-03-31")
    explication = " ".join(t1.hypotheses)

    assert t1.ca_encaisse == 0.0
    assert "Aucun encaissement sur cette période" in explication
    assert "2026-08" in explication, "la période qui porte le CA doit être nommée"
    assert "reste due" in explication


def test_une_annee_reellement_vide_invite_a_verifier_la_capture():
    """Rien nulle part : ce n'est pas la même chose qu'un CA sur un autre trimestre."""
    explication = " ".join(_generer(debut="2026-01-01", fin="2026-03-31").hypotheses)

    assert "Aucun encaissement rapproché sur l'année" in explication
    assert "vérifiez que vos virements sont bien capturés" in explication


def test_une_periode_pleine_n_ajoute_aucune_explication_inutile():
    _facture("FA-2026-000001", 1000.0)
    _virement("v1", 1000.0, "FA-2026-000001")

    explication = " ".join(_generer().hypotheses)
    assert "Aucun encaissement" not in explication
