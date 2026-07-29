"""Couche de PRÉSENTATION (UX) — 100 % isolée du droit.

Elle prend le verdict juridique (`AnalyseJuridique`) et décide COMMENT le présenter :
  • quel parcours afficher (bandes d'arbitrage — pure heuristique UX, jamais des seuils légaux) ;
  • les phrases, bandeaux, catalogues d'étapes, phases.

Modifier une bande ou une phrase ici ne change JAMAIS l'analyse juridique : les deux couches
sont volontairement découplées (cf. analyse_juridique.py). Aucun seuil/taux/coût codé en dur :
tout vient de data/seuils.yaml.
"""
from __future__ import annotations

from app.agents.guidance.roadmap import seuils as S
from app.agents.guidance.roadmap._format import pct
from app.agents.guidance.roadmap.analyse_juridique import DURABILITE_DURABLE
from app.agents.guidance.roadmap.models import AnalyseJuridique, Bandeau, Etape, Mixte, Phase, Prorata, SeuilProfil

PARCOURS_MICRO = "micro"
PARCOURS_SOCIETE = "societe"
PARCOURS_BASCULE = "bascule"

# --- Bandes d'arbitrage (heuristiques d'AFFICHAGE, PAS des seuils légaux) -----
#   ratio = CA / seuil micro de la catégorie (pour le mixte, le PLUS contraignant des deux plafonds)
#   ratio < BAS            -> micro (confortablement sous le plafond)
#   BAS <= ratio <= HAUT   -> bascule (zone d'arbitrage : juste autour du plafond, la tolérance de
#                             franchissement laisse le micro possible -> on montre les deux options)
#   ratio > HAUT           -> société (le plafond est NETTEMENT franchi : la société est la voie mature)
# HAUT est volontairement proche de 1 : dès qu'on dépasse le plafond de plus de ~10 %, on ne présente
# plus le micro comme un choix « à arbitrer » mais on oriente vers la société. La tolérance légale des
# 2 ans reste expliquée dans les étapes/comparatif ; elle ne fait pas du dépassement une situation neutre.
BANDE_BASCULE_BAS = 0.90
BANDE_BASCULE_HAUT = 1.10


def choisir_parcours(analyse: AnalyseJuridique) -> str:
    """Choisit le parcours UX à présenter à partir du ratio légal.

    Garde-fou juridique : si la loi impose la sortie (dépassement durable avéré), on force le
    parcours société quelle que soit la bande d'affichage.
    """
    if analyse.durabilite == DURABILITE_DURABLE:
        return PARCOURS_SOCIETE
    ratio = analyse.ratio_legal
    if ratio < BANDE_BASCULE_BAS:
        return PARCOURS_MICRO
    if ratio <= BANDE_BASCULE_HAUT:
        return PARCOURS_BASCULE
    return PARCOURS_SOCIETE


# ---------------------------------------------------------------------------
#  Phrases de régime et bandeaux
# ---------------------------------------------------------------------------
def _eur(n) -> str:
    """Montant en euros avec espace fine comme séparateur de milliers (jamais de virgule, qui
    entrerait en conflit avec la ponctuation française des phrases)."""
    return f"{n:,.0f}".replace(",", " ")


def _mention_prorata(prorata: Prorata) -> str:
    if not prorata.applique:
        return ""
    return (f" Seuil proratisé pour votre 1re année ({prorata.jours} jours) : "
            f"{_eur(prorata.seuil_plein)} € → {_eur(prorata.seuil_ajuste)} €.")


def _phrase_mixte(analyse: AnalyseJuridique, parcours: str) -> str:
    """Phrase de régime pour l'activité MIXTE : deux plafonds distincts s'appliquent (global sur
    le CA total, services sur la seule part prestations). On ne compare donc jamais le CA global
    au sous-plafond services comme s'il s'agissait de l'unique plafond."""
    m = S.bloc("micro")["mixte"]
    tva = S.bloc("tva_franchise")
    fr = S.bloc("franchissement")
    ca_g = analyse.ca_retenu.ca_global
    ca_p = analyse.ca_retenu.ca_prestations
    seuil_glob = int(m["seuil_global"])
    seuil_serv = analyse.seuil_effectif
    ventile = analyse.ca_retenu.ca_prestations > 0 or analyse.ca_retenu.ca_vente > 0
    prorata = _mention_prorata(analyse.prorata)
    plafonds = (f"deux plafonds s'appliquent simultanément : {_eur(seuil_glob)} € sur le CA global "
                f"et {_eur(seuil_serv)} € sur la seule part prestations de services")
    if parcours == PARCOURS_SOCIETE:
        # La société mixte n'est atteinte qu'avec une ventilation (le global seul ne dépasse pas 1,5×).
        return (f"Votre activité mixte dépasse le cadre du régime micro ({plafonds}) : "
                f"une société (EURL/SASU) est à privilégier.{prorata}")
    if parcours == PARCOURS_MICRO and ventile:
        return (f"La micro-entreprise est adaptée à votre activité mixte : votre CA global "
                f"({_eur(ca_g)} €) et votre part prestations ({_eur(ca_p)} €) restent sous leurs "
                f"plafonds ({_eur(seuil_glob)} € et {_eur(seuil_serv)} €). Simple et rapide à créer.{prorata}")
    if parcours == PARCOURS_MICRO:
        return (f"La micro-entreprise est adaptée : votre CA estimé ({_eur(ca_g)} €) reste sous le "
                f"plafond micro global ({_eur(seuil_glob)} €). Précisez la répartition prestations / "
                f"ventes pour vérifier aussi le sous-plafond services ({_eur(seuil_serv)} €).{prorata}")
    base = int(tva["services"]["seuil_base"])
    return (f"À arbitrer : pour votre activité mixte, {plafonds}. Un dépassement une seule année "
            f"n'exclut pas du micro (sortie seulement après {fr['annees_consecutives']} années "
            f"consécutives), mais la TVA sur vos prestations devient due dès {_eur(base)} € : "
            f"comparez micro et société.{prorata}")


def phrase_regime(analyse: AnalyseJuridique, parcours: str) -> str:
    if analyse.categorie == "mixte":
        return _phrase_mixte(analyse, parcours)
    tva = S.bloc("tva_franchise")
    fr = S.bloc("franchissement")
    ca = analyse.ca_retenu.ca_global
    seuil = analyse.seuil_effectif
    prorata = _mention_prorata(analyse.prorata)
    if parcours == PARCOURS_MICRO:
        return (f"La micro-entreprise est adaptée : votre CA estimé ({_eur(ca)} €) reste "
                f"sous le plafond micro ({_eur(seuil)} €). Simple et rapide à créer.{prorata}")
    if parcours == PARCOURS_SOCIETE:
        return (f"Votre CA estimé ({_eur(ca)} €) est structurellement très au-dessus du "
                f"plafond micro ({_eur(seuil)} €) : une société (EURL/SASU) est à privilégier.{prorata}")
    base = tva["services"]["seuil_base"] if analyse.categorie != "bic_vente" else tva["vente"]["seuil_base"]
    return (f"À arbitrer : votre CA estimé ({_eur(ca)} €) est proche/au-dessus du plafond "
            f"micro ({_eur(seuil)} €). Un dépassement une seule année n'exclut pas du micro "
            f"(sortie seulement après {fr['annees_consecutives']} années consécutives), mais la "
            f"TVA devient due dès {_eur(base)} € : comparez micro et société.{prorata}")


_LIBELLES_BANDEAU = {
    PARCOURS_MICRO: ("Micro-entreprise", "micro"),
    PARCOURS_SOCIETE: ("Société (EURL/SASU)", "societe"),
    PARCOURS_BASCULE: ("À arbitrer", "bascule"),
}


def bandeau(analyse: AnalyseJuridique, parcours: str) -> Bandeau:
    titre, typ = _LIBELLES_BANDEAU[parcours]
    return Bandeau(type=typ, titre=titre, texte=phrase_regime(analyse, parcours))


# ---------------------------------------------------------------------------
#  Détails d'étapes sensibles à la catégorie
# ---------------------------------------------------------------------------
def _params_categorie(categorie: str) -> dict:
    micro = S.bloc("micro")
    tva = S.bloc("tva_franchise")
    social = S.bloc("micro_social")
    vl = S.bloc("versement_liberatoire")
    if categorie == "bic_vente":
        return {
            "social_txt": f"vente de marchandises (BIC) : {pct(social['vente'])}",
            "tva": tva["vente"], "tva_txt": "votre vente de marchandises",
            "abatt_pct": int(micro["bic_vente"]["abattement"] * 100), "abatt_min": None,
            "vl_txt": f"{pct(vl['vente'])} du CA en vente",
        }
    if categorie == "mixte":
        return {
            "social_txt": (f"prestations BNC (régime général) {pct(social['bnc_regime_general'])} / "
                           f"vente {pct(social['vente'])}, chacun sur sa part de CA"),
            "tva": tva["services"], "tva_txt": "vos prestations de services (part limitante)",
            "abatt_pct": int(micro["bnc"]["abattement"] * 100), "abatt_min": int(micro["mixte"]["abattement_min"]),
            "vl_txt": f"{pct(vl['bnc'])} du CA en BNC (et {pct(vl['vente'])} sur la part vente)",
        }
    return {  # bnc (défaut créateur/influence)
        "social_txt": f"prestations BNC (régime général) : {pct(social['bnc_regime_general'])}",
        "tva": tva["services"], "tva_txt": "vos prestations BNC",
        "abatt_pct": int(micro["bnc"]["abattement"] * 100), "abatt_min": int(micro["bnc"]["abattement_min"]),
        "vl_txt": f"{pct(vl['bnc'])} du CA en BNC",
    }


def _detail_tva(categorie: str, p: dict, tva: dict) -> str:
    """Explication des seuils de franchise en base de TVA, avec la règle des DEUX seuils :
    base (redevable au 1er janvier suivant) et majoré (redevable dès le 1er jour de dépassement).
    En activité mixte, chaque part (services / vente) a ses propres seuils, mesurés séparément."""
    s_base, s_maj = int(tva["services"]["seuil_base"]), int(tva["services"]["seuil_majore"])
    v_base, v_maj = int(tva["vente"]["seuil_base"]), int(tva["vente"]["seuil_majore"])
    if categorie == "mixte":
        return (
            "Chaque activité a ses propres seuils de franchise en base de TVA, qui sautent AVANT le "
            f"plafond micro et se mesurent séparément. Prestations de services : base {_eur(s_base)} € "
            f"(redevable au 1er janvier suivant), majoré {_eur(s_maj)} € (redevable dès le 1er jour de "
            f"dépassement). Vente de produits : base {_eur(v_base)} €, majoré {_eur(v_maj)} € (mêmes "
            "règles). Au-delà, vous facturez la TVA sur la part concernée.")
    base, maj = int(p["tva"]["seuil_base"]), int(p["tva"]["seuil_majore"])
    return (
        f"Pour {p['tva_txt']}, la franchise de TVA saute AVANT le plafond micro : seuil de base "
        f"{_eur(base)} € (redevable au 1er janvier suivant), seuil majoré {_eur(maj)} € (redevable "
        "dès le 1er jour de dépassement). Au-delà, vous facturez la TVA.")


def _etapes_micro(categorie: str) -> list[dict]:
    micro = S.bloc("micro")
    social = S.bloc("micro_social")
    vl = S.bloc("versement_liberatoire")
    cb = S.bloc("compte_bancaire_dedie")
    tva = S.bloc("tva_franchise")
    p = _params_categorie(categorie)
    seuil_cb = int(cb["seuil"])
    tva_detail = _detail_tva(categorie, p, tva)
    abatt_txt = (f"{p['abatt_pct']} %"
                 + (f" (minimum {p['abatt_min']} €)" if p["abatt_min"] else ""))
    return [
        {
            "id": "activite", "parcours": "micro", "phase": "preparer",
            "titre": "Vérifier la nature de l'activité et le code APE",
            "detail": "La création de contenu/influence relève des BNC (bénéfices non commerciaux, "
                      "activité libérale) car c'est une prestation de promotion. La vente de merch "
                      "relève des BIC. La catégorie dépend de la NATURE de l'activité, pas du statut.",
            "lien": "https://entreprendre.service-public.gouv.fr/vosdroits/F32919",
            "obligatoire": True,
        },
        {
            "id": "guichet_unique", "parcours": "micro", "phase": "creer",
            "titre": "Créer la micro-entreprise sur le Guichet unique (INPI)",
            "detail": "Depuis 2023, toute création se fait exclusivement sur le Guichet unique. "
                      "Vous obtenez un numéro SIREN/SIRET sous quelques jours.",
            "lien": "https://formalites.entreprises.gouv.fr",
            "obligatoire": True,
        },
        {
            "id": "urssaf", "parcours": "micro", "phase": "creer",
            "titre": "Activer votre compte de déclaration URSSAF auto-entrepreneur",
            "detail": "Vous y déclarez votre chiffre d'affaires (mensuel ou trimestriel) et payez vos "
                      f"cotisations sociales. Taux micro-social {p['social_txt']} en {social['annee']}.",
            "lien": "https://www.autoentrepreneur.urssaf.fr",
            "obligatoire": True,
        },
        {
            "id": "compte_bancaire", "parcours": "micro", "phase": "faire_vivre",
            "titre": "Ouvrir un compte bancaire dédié",
            "detail": f"Obligatoire si votre CA dépasse {seuil_cb:,} € pendant "
                      f"{cb['annees_consecutives']} années consécutives. Recommandé dès le départ "
                      "pour séparer perso et pro.".replace(",", " "),
            "lien": "https://entreprendre.service-public.gouv.fr/vosdroits/F35991",
            "obligatoire": False,
        },
        {
            "id": "acre", "parcours": "micro", "phase": "creer",
            "titre": "Vérifier l'éligibilité à l'ACRE (exonération partielle de cotisations)",
            "detail": "Réduction de cotisations la première année sous conditions (notamment selon "
                      "votre situation : demandeur d'emploi, jeune, etc.). À demander au moment de la création.",
            "lien": "https://www.autoentrepreneur.urssaf.fr/portail/accueil/une-question/questions-sur-la-creation.html",
            "obligatoire": False,
        },
        {
            "id": "tva", "parcours": "micro", "phase": "faire_vivre",
            "titre": "Surveiller les seuils de franchise en base de TVA",
            "detail": tva_detail,
            "lien": "https://entreprendre.service-public.gouv.fr/vosdroits/F21746",
            "obligatoire": True,
        },
        {
            "id": "mentions_pub", "parcours": "micro", "phase": "faire_vivre",
            "titre": "Respecter la loi Influenceurs (transparence des partenariats)",
            "detail": "Loi n° 2023-451 du 9 juin 2023 : mentions « Publicité » ou « Collaboration "
                      "commerciale » obligatoires. Les cadeaux reçus (giftings) sont des avantages en "
                      "nature imposables à leur valeur vénale — et entrant aussi dans l'assiette sociale.",
            "lien": "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000047663185",
            "obligatoire": True,
        },
        {
            "id": "comptabilite", "parcours": "micro", "phase": "faire_vivre",
            "titre": "Tenir une comptabilité minimale (livre des recettes)",
            "detail": f"Conservez factures et justificatifs. Un abattement forfaitaire de {abatt_txt} "
                      "s'applique sur le CA pour déterminer le bénéfice imposable.",
            "lien": "https://entreprendre.service-public.gouv.fr/vosdroits/F23267",
            "obligatoire": True,
        },
        {
            "id": "declaration_revenus", "parcours": "micro", "phase": "faire_vivre",
            "titre": "Déclarer vos revenus (2042-C-PRO) et choisir le versement libératoire éventuel",
            "detail": "Le micro se déclare sur la 2042-C-PRO. Option versement libératoire de l'IR "
                      f"({p['vl_txt']}) possible si le revenu fiscal de référence N-2 ne dépasse pas "
                      f"{int(vl['rfr_max_par_part']):,} € par part. La déclaration URSSAF du CA est un "
                      "circuit distinct qui se cumule.".replace(",", " "),
            "lien": "https://www.impots.gouv.fr/particulier/questions/comment-declarer-mes-revenus-dauto-entrepreneur",
            "obligatoire": True,
        },
    ]


def _etapes_societe() -> list[dict]:
    tva = S.bloc("tva_franchise")
    s_base, s_maj = int(tva["services"]["seuil_base"]), int(tva["services"]["seuil_majore"])
    v_base, v_maj = int(tva["vente"]["seuil_base"]), int(tva["vente"]["seuil_majore"])
    return [
        {
            "id": "choix_forme", "parcours": "societe", "phase": "preparer",
            "titre": "Choisir la forme juridique : EURL ou SASU",
            "detail": "EURL (gérant associé unique = travailleur non salarié, cotisations SSI, IR par "
                      "défaut avec option IS) vs SASU (président = assimilé salarié, régime général, IS "
                      "par défaut, dividendes possibles). Le choix impacte régime social, fiscalité et "
                      "protection sociale.",
            "lien": "https://entreprendre.service-public.gouv.fr/vosdroits/F23844",
            "obligatoire": True,
        },
        {
            "id": "statuts", "parcours": "societe", "phase": "preparer",
            "titre": "Rédiger les statuts",
            "detail": "Acte écrit fixant forme juridique, objet social, dénomination, siège, capital et "
                      "règles de fonctionnement. Rédigeables seul ou avec un professionnel (avocat, "
                      "expert-comptable).",
            "lien": "https://entreprendre.service-public.gouv.fr/vosdroits/F32232",
            "obligatoire": True,
        },
        {
            "id": "capital", "parcours": "societe", "phase": "creer",
            "titre": "Déposer le capital social",
            "detail": "Dépôt des apports en numéraire (banque, notaire ou Caisse des dépôts) : une "
                      "attestation de dépôt des fonds vous est remise pour le dossier d'immatriculation.",
            "lien": "https://entreprendre.service-public.gouv.fr/vosdroits/F32886",
            "obligatoire": True,
        },
        {
            "id": "annonce_legale", "parcours": "societe", "phase": "creer",
            "titre": "Publier une annonce légale de constitution",
            "detail": "Publication dans un support habilité à recevoir des annonces légales (SHAL) du "
                      "département du siège, une fois les statuts signés.",
            "lien": "https://entreprendre.service-public.gouv.fr/vosdroits/F32886",
            "obligatoire": True,
        },
        {
            "id": "immatriculation", "parcours": "societe", "phase": "creer",
            "titre": "Immatriculer la société sur le Guichet unique",
            "detail": "Dépôt du dossier sur le Guichet unique : transmission à l'INPI (RNE), au greffe "
                      "(RCS), aux organismes sociaux et au service des impôts des entreprises.",
            "lien": "https://formalites.entreprises.gouv.fr",
            "obligatoire": True,
        },
        {
            "id": "kbis", "parcours": "societe", "phase": "creer",
            "titre": "Obtenir l'extrait Kbis (immatriculation RCS)",
            "detail": "Une fois l'immatriculation validée, la société obtient son SIREN/SIRET et son "
                      "extrait Kbis, carte d'identité officielle de l'entreprise.",
            "lien": "https://entreprendre.service-public.gouv.fr/vosdroits/F35934",
            "obligatoire": True,
        },
        {
            "id": "affiliation_dirigeant", "parcours": "societe", "phase": "creer",
            "titre": "Régler l'affiliation sociale du dirigeant",
            "detail": "EURL : le gérant associé unique est travailleur non salarié (SSI). SASU : le "
                      "président est assimilé salarié (régime général) dès qu'il est rémunéré. À vérifier "
                      "selon la forme retenue.",
            "lien": "https://entreprendre.service-public.gouv.fr/vosdroits/F37383",
            "obligatoire": True,
        },
        {
            "id": "tva_societe", "parcours": "societe", "phase": "faire_vivre",
            "titre": "Choisir le régime de TVA",
            "detail": ("Une société relève en principe d'un régime réel de TVA. La franchise en base "
                       f"reste possible sous les seuils de base (services {_eur(s_base)} € / vente "
                       f"{_eur(v_base)} €), mais rarement pertinente à ce niveau d'activité : au-delà du "
                       f"seuil majoré (services {_eur(s_maj)} € / vente {_eur(v_maj)} €), la TVA est due "
                       "dès le 1er jour de dépassement. Régimes : réel simplifié ou réel normal selon le "
                       "chiffre d'affaires."),
            "lien": "https://www.impots.gouv.fr/professionnel/les-regimes-dimposition-la-tva",
            "obligatoire": True,
        },
        {
            "id": "comptabilite_reelle", "parcours": "societe", "phase": "faire_vivre",
            "titre": "Tenir une comptabilité réelle (bilan, expert-comptable)",
            "detail": "Comptabilité d'engagement complète : journal, grand livre, comptes annuels "
                      "(bilan, compte de résultat), dépôt des comptes. Le recours à un expert-comptable "
                      "est fortement recommandé.",
            "lien": "https://entreprendre.service-public.gouv.fr/vosdroits/F32886",
            "obligatoire": True,
        },
        {
            "id": "declarations_societe", "parcours": "societe", "phase": "faire_vivre",
            "titre": "Assurer les déclarations récurrentes (résultat, TVA, CFE)",
            "detail": "Déclaration de résultat (IS ou IR selon l'option), déclarations de TVA périodiques, "
                      "et cotisation foncière des entreprises (CFE). Échéances à suivre chaque année.",
            "lien": "https://www.impots.gouv.fr/professionnel",
            "obligatoire": True,
        },
    ]


# Durée (estimée) et coût (SOURCÉ — rien affiché si non trouvé) par étape.
_META_ETAPES = {
    "guichet_unique": {"duree": "~20 min en ligne", "cout": "gratuit"},
    "urssaf": {"duree": "~10 min"},
    "compte_bancaire": {"duree": "~30 min"},
    "acre": {"duree": "~10 min"},
    "declaration_revenus": {"duree": "~30 min/an"},
    "statuts": {"duree": "de quelques heures à quelques jours"},
    "capital": {"duree": "délai bancaire ~1 semaine"},
    "annonce_legale": {"duree": "~15 min",
                       "cout": "142 à 148 € HT selon la forme (SASU/EURL, 2026)",
                       "cout_source": "https://entreprendre.service-public.gouv.fr/actualites/A18724"},
    "immatriculation": {"duree": "quelques jours de délai"},
    "kbis": {"duree": "délivré après immatriculation"},
}


def construire_etapes(etapes_parcours: str, categorie: str, profil: dict) -> list[Etape]:
    """Construit les étapes du parcours, annotées (durée/coût sourcés, cadeaux) et typées."""
    modeles = _etapes_micro(categorie) if etapes_parcours == PARCOURS_MICRO else _etapes_societe()
    recoit_cadeaux = bool(profil.get("recoit_cadeaux"))
    etapes: list[Etape] = []
    for modele in modeles:
        e = dict(modele)
        meta = _META_ETAPES.get(e["id"])
        if meta:
            e.update(meta)
        if e["id"] == "mentions_pub" and recoit_cadeaux:
            e["detail"] += (" Vous recevez des cadeaux : enregistrez leur valeur vénale — "
                            "imposable (fiscal), soumise à cotisations (social) et comptant dans "
                            "vos seuils micro et TVA.")
        etapes.append(Etape(**e))
    return etapes


# ---------------------------------------------------------------------------
#  Phases
# ---------------------------------------------------------------------------
PHASES_LIBELLES = {"preparer": "Préparer", "creer": "Créer", "faire_vivre": "Faire vivre"}


def grouper_en_phases(etapes: list[Etape]) -> list[Phase]:
    phases: list[Phase] = []
    for pid, libelle in PHASES_LIBELLES.items():
        sous = [e for e in etapes if e.phase == pid]
        if sous:
            phases.append(Phase(id=pid, titre=libelle, etapes=sous))
    return phases


# ---------------------------------------------------------------------------
#  Explication activité mixte + seuils du profil (en-tête récapitulatif)
# ---------------------------------------------------------------------------
def explication_mixte(analyse: AnalyseJuridique) -> Mixte:
    micro = S.bloc("micro")
    m = micro["mixte"]
    return Mixte(
        titre="Activité mixte : double catégorie BIC (vente) + BNC (prestations)",
        texte=(
            f"Vos prestations de promotion relèvent des BNC et votre vente de produits des BIC. "
            f"Deux plafonds s'appliquent SIMULTANÉMENT : CA global ≤ {int(m['seuil_global']):,} € "
            f"DONT part prestations de services ≤ {int(m['seuil_services']):,} €. Les abattements "
            f"diffèrent (71 % vente / {int(micro['bnc']['abattement'] * 100)} % BNC) et le minimum "
            f"d'abattement est porté à {int(m['abattement_min'])} €."
        ).replace(",", " "),
        source=m["source"],
    )


def seuils_profil(analyse: AnalyseJuridique) -> list[SeuilProfil]:
    """Jauges de position CA / seuil. RÈGLE : chaque seuil est comparé à la SEULE part de CA qu'il
    gouverne (jamais le CA global contre un sous-plafond de catégorie). En activité mixte, deux
    plafonds micro coexistent (global + services) et la TVA se lit part par part."""
    tva = S.bloc("tva_franchise")
    prorata_lbl = " (proratisé 1re année)" if analyse.prorata.applique else ""

    if analyse.categorie == "mixte":
        m = S.bloc("micro")["mixte"]
        ca_g = analyse.ca_retenu.ca_global
        ca_p = analyse.ca_retenu.ca_prestations
        ca_v = analyse.ca_retenu.ca_vente
        seuil_glob = int(m["seuil_global"])
        barres = [SeuilProfil(label="Plafond micro global", seuil=seuil_glob, seuil_plein=seuil_glob,
                              position=ca_g, unite="€", source=m["source"])]
        # Sans ventilation, on ne fabrique pas de comparaison par part (elle serait trompeuse) :
        # seule la jauge globale, honnête, est montrée.
        if ca_p > 0 or ca_v > 0:
            barres.append(SeuilProfil(label="Sous-plafond services (prestations)" + prorata_lbl,
                          seuil=analyse.seuil_effectif, seuil_plein=analyse.seuil_plein,
                          position=ca_p, unite="€", source=analyse.source_legale))
            barres.append(SeuilProfil(label="Franchise TVA services (prestations)",
                          seuil=int(tva["services"]["seuil_base"]),
                          position=ca_p, unite="€", source=tva["source"]))
            if ca_v > 0:
                barres.append(SeuilProfil(label="Franchise TVA vente (produits)",
                              seuil=int(tva["vente"]["seuil_base"]),
                              position=ca_v, unite="€", source=tva["source"]))
        return barres

    # Mono-catégorie : tout le CA relève d'une seule catégorie -> comparaison directe (déjà correcte).
    cat_tva = "vente" if analyse.categorie == "bic_vente" else "services"
    ca = analyse.ca_retenu.ca_global
    return [
        SeuilProfil(label="Plafond micro" + prorata_lbl, seuil=analyse.seuil_effectif,
                    seuil_plein=analyse.seuil_plein, position=ca, unite="€", source=analyse.source_legale),
        SeuilProfil(label="Franchise TVA (base)", seuil=int(tva[cat_tva]["seuil_base"]),
                    position=ca, unite="€", source=tva["source"]),
        SeuilProfil(label="Franchise TVA (majoré)", seuil=int(tva[cat_tva]["seuil_majore"]),
                    position=ca, unite="€", source=tva["source"]),
    ]
