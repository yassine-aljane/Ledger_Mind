"""Orchestrateur conversationnel : mémoire locale, profilage progressif et RAG sourcé."""
from __future__ import annotations

import json
import re

from app.agents import guidance, pedagogue
from app.llm.mistral_client import chat
from app.memory import store
from app.roadmap import analyse_juridique as AJ
from app.roadmap import parcours

_CREATION = ("créer", "creer", "immatric", "roadmap", "feuille de route", "débute", "debute", "micro-entreprise")

# Mots-clés d'activité (cherchés N'IMPORTE OÙ dans le message) -> libellé lisible.
# Plateformes/spécifiques d'abord, génériques ensuite : le premier match gagne.
_ACTIVITES = [
    ("youtube", "YouTube"), ("instagram", "Instagram"), ("tiktok", "TikTok"),
    ("twitch", "Twitch"), ("linkedin", "LinkedIn"), ("podcast", "podcast"),
    ("influenc", "influence"), ("streamer", "streaming"), ("stream", "streaming"),
    ("graphiste", "graphisme"), ("photograph", "photographie"), ("vidéo", "création de contenu vidéo"),
    ("video", "création de contenu vidéo"), ("rédac", "rédaction"), ("redac", "rédaction"),
    ("développ", "développement"), ("developp", "développement"), ("consultant", "conseil"),
    ("coach", "coaching"), ("freelance", "freelance"), ("blog", "blog"),
    ("créat", "création de contenu"), ("creat", "création de contenu"),
]

# Période -> multiplicateur d'annualisation (calcul DÉTERMINISTE, jamais délégué au LLM).
_PERIODES = {"mois": 12, "semaine": 52, "jour": 365, "an": 1, "année": 1, "annee": 1}
_NUM = r"(\d[\d\s ]*\d|\d)"


def _montant(txt: str) -> float:
    return float(txt.replace(" ", "").replace(" ", ""))


def _ca_annuel(m: str) -> float | None:
    """Extrait un CA et l'annualise. Gère le suffixe 'k', le '€' optionnel et la période."""
    # 1) montant + période (ex. « environ 3000 par mois », « 3 k / mois », « 45000 € par an »)
    mm = re.search(_NUM + r"\s*(k)?\s*(?:€|euros?)?\s*(?:/|par\s+)\s*(mois|an|année|annee|semaine|jour)", m)
    if mm:
        val = _montant(mm.group(1)) * (1000 if mm.group(2) else 1)
        return val * _PERIODES[mm.group(3)]
    # 2) CA/chiffre d'affaires annoncé sans période (ex. « un CA de 45000 », « chiffre d'affaires 45 000 € »)
    mm = re.search(r"(?:ca|chiffre d['’ ]affaires)\D{0,6}" + _NUM + r"\s*(k)?", m)
    if mm:
        return _montant(mm.group(1)) * (1000 if mm.group(2) else 1)
    return None


def _extraire_profil_regex(message: str) -> dict:
    """Extraction déterministe de repli (si l'extraction sémantique LLM échoue)."""
    m = message.lower()
    out: dict = {}
    for cle, libelle in _ACTIVITES:
        if cle in m:
            out["activite"] = libelle
            break
    ca = _ca_annuel(m)
    if ca is not None:
        out["ca_estime"] = ca
    # Vente = verbe de vente explicite (surtout PAS le simple mot « produits », qui apparaît
    # dans « produits gratuits » = cadeaux reçus). La NÉGATION est testée en premier pour ne pas
    # faire matcher « vente de » dans « pas de vente de produits ».
    if re.search(r"\b(non|pas de|aucun|aucune|sans)\b[^.?!]*(?:produit|merch|vente|marchandise)", m) or "pas de vente" in m or "que des prestations" in m:
        out["vend_produits"] = False
    elif any(w in m for w in ("merch", "boutique", "je vends", "vends des", "vends du", "vente de", "revends", "e-commerce", "dropshipping")):
        out["vend_produits"] = True
    if any(w in m for w in ("cadeau", "produit gratuit", "produits gratuits", "dotation", "gifting")):
        out["recoit_cadeaux"] = True
    if "salari" in m: out["situation_actuelle"] = "salarié"
    elif "étudiant" in m or "etudiant" in m: out["situation_actuelle"] = "étudiant"
    elif "demandeur d'emploi" in m or "chômage" in m or "chomage" in m: out["situation_actuelle"] = "demandeur d'emploi"
    if any(w in m for w in ("déjà immatricul", "deja immatricul", "j'ai un siret", "j’ai un siret")):
        out["deja_immatricule"] = True
    elif any(w in m for w in ("pas encore immatricul", "pas de siret", "aucun siret", "pas immatricul")):
        out["deja_immatricule"] = False
    return out


# --- Extraction SÉMANTIQUE du profil (LLM) : négations, synonymes, montants + devise ---
# Les cadeaux/dotations ne sont PAS une catégorie de CA : c'est une rémunération EN NATURE d'une
# prestation. Leur valeur alimente donc les prestations, jamais les ventes.
_EXTRACTION_SYS = """Tu extrais des informations de profil depuis UN message d'un créateur de
contenu / freelance français, dans une conversation d'accompagnement à la création d'activité.

Réponds en JSON STRICT, avec UNIQUEMENT les champs EXPLICITEMENT exprimés dans le message
(sinon null). Ne devine jamais. Comprends les négations, les synonymes/argot et les montants avec
leur devise et leur période.

Schéma :
{
  "activite": string|null,
  "ca_montant": number|null,          // CA/revenu TOTAL si donné globalement, sans détail par catégorie
  "prestations_montant": number|null, // prestations de services rémunérées EN ARGENT
  "cadeaux_montant": number|null,     // VALEUR des cadeaux/produits reçus gratuitement (rémunération EN NATURE d'une prestation) — jamais une vente
  "vente_montant": number|null,       // ventes de biens/produits/merch
  "periode": "an"|"mois"|"semaine"|"jour"|null,
  "devise": string|null,              // code devise cité ("EUR","USD","GBP"...) ; null si non précisé
  "vend_produits": true|false|null,   // vend des biens/produits/merch ? false si NIÉ
  "recoit_cadeaux": true|false|null,  // reçoit cadeaux/produits gratuits/dotations/gifting ?
  "situation_actuelle": "salarié"|"étudiant"|"demandeur d'emploi"|"indépendant"|"retraité"|"autre"|null,
  "deja_immatricule": true|false|null,
  "debut_activite_cette_annee": true|false|null, // vient de démarrer / n'avait AUCUNE activité l'an dernier ?
  "ca_an_dernier_au_dessus_plafond": true|false|null // réponse à "ton CA de l'an dernier dépassait-il le plafond micro ?"
}

Règles impératives :
- CADEAUX : "cadeaux 10000", "on m'offre pour 10000 de produits", "dotations 10000" -> renseigne
  cadeaux_montant=10000, JAMAIS vente_montant. Les cadeaux sont une rémunération en nature d'une
  prestation, pas une vente ni une catégorie de CA à part.
- Négations : "je ne vends pas de produits" -> vend_produits=false ; "je ne suis pas salarié" ->
  situation_actuelle=null (sauf autre situation donnée) ; "pas encore immatriculé" -> deja_immatricule=false.
- Montants : "3000 euros par mois" -> ca_montant=3000, periode="mois", devise="EUR" ;
  "3 k/mois" -> 3000,"mois" ; "2000 dollars par mois" -> ca_montant=2000, periode="mois", devise="USD".
- DÉBUT D'ACTIVITÉ : "je débute cette année", "je viens de me lancer", "je démarre", "première
  année", "je n'avais pas d'activité avant" -> debut_activite_cette_annee=true. Dans ce cas, l'an
  dernier il n'y avait aucun chiffre d'affaires -> ca_an_dernier_au_dessus_plafond=false.
- HISTORIQUE N-1 : à la question "ton CA de l'an dernier dépassait-il déjà le plafond ?", "oui" /
  "je dépassais déjà" -> ca_an_dernier_au_dessus_plafond=true ; "non" / "j'étais en dessous" /
  "je débutais" -> ca_an_dernier_au_dessus_plafond=false. Ne devine JAMAIS sans indication.
- Renvoie exclusivement le JSON."""

_MULT_PERIODE = {"an": 1, "annee": 1, "année": 1, "mois": 12, "semaine": 52, "jour": 365}


def _annualiser(montant, periode: str | None):
    if not isinstance(montant, (int, float)):
        return None
    return float(montant) * _MULT_PERIODE.get((periode or "an"), 1)


async def _extraire_brut(message: str) -> dict:
    """Appel LLM : renvoie les composantes brutes extraites (JSON), sans calcul."""
    out = await chat(
        [{"role": "system", "content": _EXTRACTION_SYS},
         {"role": "user", "content": message}],
        temperature=0.0, max_tokens=320, json_mode=True,
    )
    return json.loads(out)


def _reconcilier(profil: dict, raw: dict) -> dict:
    """Mapping DÉTERMINISTE des composantes extraites vers le profil.

    Reconstruit : prestations = argent + rémunération en nature (cadeaux) ; CA total =
    prestations + ventes. Ne remplace jamais silencieusement une devise.
    """
    up: dict = {}
    if isinstance(raw.get("activite"), str) and raw["activite"].strip():
        up["activite"] = raw["activite"].strip()
    for k in ("vend_produits", "recoit_cadeaux", "deja_immatricule"):
        if isinstance(raw.get(k), bool):
            up[k] = raw[k]

    # Durabilité (historique N-1). « Je débute cette année » implique qu'il n'y avait aucune
    # activité l'an dernier -> CA N-1 sous le plafond (durabilité au pire ponctuelle, jamais durable).
    # La réponse directe à la question de durabilité prime si elle est donnée.
    if isinstance(raw.get("ca_an_dernier_au_dessus_plafond"), bool):
        up["ca_n_1_au_dessus_seuil"] = raw["ca_an_dernier_au_dessus_plafond"]
    elif raw.get("debut_activite_cette_annee") is True:
        up["ca_n_1_au_dessus_seuil"] = False
    if isinstance(raw.get("situation_actuelle"), str) and raw["situation_actuelle"].strip():
        up["situation_actuelle"] = raw["situation_actuelle"].strip()
    dev = (raw.get("devise") or "").strip().upper() or None
    if dev:
        up["devise"] = dev

    per = raw.get("periode")
    presta_new = _annualiser(raw.get("prestations_montant"), per)   # prestations en argent
    cadeaux_new = _annualiser(raw.get("cadeaux_montant"), per)      # rémunération en nature
    vente_new = _annualiser(raw.get("vente_montant"), per)
    total_new = _annualiser(raw.get("ca_montant"), per)

    # État courant décomposé (prestations = argent + nature)
    cur_presta = profil.get("ca_prestations")
    cur_rem = profil.get("remuneration_nature")
    cur_cash = (cur_presta - (cur_rem or 0)) if cur_presta is not None else None

    rem = cadeaux_new if cadeaux_new is not None else cur_rem
    cash = presta_new if presta_new is not None else cur_cash
    ca_presta = ((cash or 0) + (rem or 0)) if (cash is not None or rem is not None) else cur_presta
    ca_vente = vente_new if vente_new is not None else profil.get("ca_vente")

    if rem is not None:
        up["remuneration_nature"] = rem
    if ca_presta is not None:
        up["ca_prestations"] = ca_presta
    if ca_vente is not None:
        up["ca_vente"] = ca_vente

    # CA total : reconstruit depuis les composantes si connues, sinon total global cité.
    if ca_presta is not None or ca_vente is not None:
        up["ca_estime"] = (ca_presta or 0) + (ca_vente or 0)
    elif total_new is not None:
        up["ca_estime"] = total_new
    return up


async def _extraire_profil(message: str, profil: dict) -> dict:
    """Extraction sémantique (LLM) + reconstruction déterministe ; repli regex si l'appel échoue."""
    try:
        return _reconcilier(profil, await _extraire_brut(message))
    except Exception:  # noqa: BLE001
        return _extraire_profil_regex(message)


# Fragments UNIQUES aux questions de profilage : servent à détecter qu'un profilage est
# en cours (le dernier tour de l'assistant était une question de profilage). On reste alors
# en mode création même si le message de l'utilisateur ne contient aucun mot-clé de création.
_MARQUEURS_PROFILAGE = (
    "activité principale (par exemple",
    "chiffre d’affaires annuel prévois-tu",
    "Vends-tu aussi des produits ou du merch",
    "Comment se répartit ton chiffre d'affaires",
    "les seuils français sont en euros",
)


def _est_creation(message: str, mode: str | None) -> bool:
    return mode == "guidance" or (mode is None and any(mot in message.lower() for mot in _CREATION))


def _profilage_actif(historique: list[dict]) -> bool:
    """Vrai si le dernier message de l'assistant était une question de profilage."""
    for m in reversed(historique):
        if m["role"] == "assistant":
            return any(marq in m["content"] for marq in _MARQUEURS_PROFILAGE)
    return False


# Questions de profilage. Le profil est INCOMPLET tant que cette liste n'est pas vide : dans ce
# cas la roadmap n'est JAMAIS générée (on ne peut pas demander une info ET produire la roadmap).
_Q_ACTIVITE = "Quelle est ton activité principale (par exemple création de contenu, prestation freelance ou vente de produits) ?"
_Q_CA = "Quel chiffre d’affaires annuel prévois-tu, même approximativement ?"
_Q_VENTE = "Vends-tu aussi des produits ou du merch, en plus de tes prestations ?"
_Q_VENTILATION = "Comment se répartit ton chiffre d'affaires entre tes prestations de services (cadeaux reçus inclus) et tes ventes de produits ?"


def _q_devise(dev: str) -> str:
    return (f"Tes montants sont en {dev}, or les seuils français sont en euros : peux-tu me donner "
            "l'équivalent en euros (ou le taux de conversion) ? Je ne convertis rien sans ta confirmation.")


def _questions_manquantes(profil: dict) -> list[dict]:
    """Liste ordonnée des infos requises restantes, chacune {champ, question}. Le SET est
    DÉTERMINISTE (jamais de roadmap sur une info légale manquante) ; seule l'interprétation des
    réponses est déléguée au LLM. Vide = profil complet pour générer la roadmap."""
    qs: list[dict] = []
    if not profil.get("activite"):
        qs.append({"champ": "activite", "question": _Q_ACTIVITE})
    if profil.get("ca_estime") is None:
        qs.append({"champ": "ca_estime", "question": _Q_CA})
    if profil.get("vend_produits") is None:
        qs.append({"champ": "vend_produits", "question": _Q_VENTE})
    dev = (profil.get("devise") or "EUR").upper()
    if dev != "EUR":
        qs.append({"champ": "devise", "question": _q_devise(dev)})
    # Activité mixte : la répartition prestations/ventes est requise (disparaît dès qu'elle est connue).
    if profil.get("vend_produits") and (profil.get("ca_prestations") is None or profil.get("ca_vente") is None):
        qs.append({"champ": "ventilation", "question": _Q_VENTILATION})
    return qs


def _question_suivante(profil: dict) -> str | None:
    qs = _questions_manquantes(profil)
    return qs[0]["question"] if qs else None


# --- Interprétation LLM d'une réponse à UNE question posée (anti-boucle contextuel) -----------
# Le LLM ne choisit pas les questions (le SET reste déterministe). Il lit la RÉPONSE et détecte si
# l'utilisateur a répondu, ne sait pas, ou si la question ne s'applique pas à sa situation — ce qui
# permet d'appliquer une hypothèse prudente au lieu de re-poser indéfiniment la même question.
_QUESTION_DURABILITE = "Ton chiffre d'affaires de l'an dernier dépassait-il déjà le plafond micro ?"

_INTERPRET_SYS = """Tu analyses la RÉPONSE d'un utilisateur à UNE question précise, dans un
accompagnement à la création d'activité en France. Tu ne réponds jamais à sa place et n'inventes rien.

On te donne la question posée et la réponse. Détermine le statut :
- "repondu"        : il fournit l'information demandée (mets-la dans "valeur").
- "ne_sait_pas"    : il ne connaît pas / n'a pas encore l'information (ex: il débute, aucune idée).
- "non_applicable" : la question n'a pas de sens dans sa situation (ex: on demande son CA de l'an
                     dernier alors qu'il débute cette année ; ou une vente alors qu'il ne vend rien).
- "hors_sujet"     : il ne répond pas à la question (il parle d'autre chose, pose une autre question).

Réponds en JSON STRICT : {"statut": "...", "valeur": <valeur ou null>}.
Type de "valeur" selon la question : nombre pour un montant, true/false pour une question oui/non,
texte court sinon. "valeur" est null sauf pour le statut "repondu"."""


async def _interpreter_reponse(question: str, message: str) -> dict:
    """Renvoie {statut, valeur}. Repli 'hors_sujet' si l'appel LLM échoue (comportement inchangé)."""
    try:
        out = await chat(
            [{"role": "system", "content": _INTERPRET_SYS},
             {"role": "user", "content": f"Question posée : {question}\nRéponse de l'utilisateur : {message}"}],
            temperature=0.0, max_tokens=120, json_mode=True,
        )
        data = json.loads(out)
        if data.get("statut") in ("repondu", "ne_sait_pas", "non_applicable", "hors_sujet"):
            return {"statut": data["statut"], "valeur": data.get("valeur")}
    except Exception:  # noqa: BLE001
        pass
    return {"statut": "hors_sujet", "valeur": None}


def _valeur_vers_profil(champ: str, valeur) -> dict | None:
    """Mappe une valeur interprétée vers le profil (repli si le type ne correspond pas)."""
    if champ == "activite":
        return {"activite": valeur.strip()} if isinstance(valeur, str) and valeur.strip() else None
    if champ == "ca_estime":
        try:
            return {"ca_estime": float(valeur)} if valeur is not None else None
        except (TypeError, ValueError):
            return None
    if champ == "vend_produits":
        return {"vend_produits": bool(valeur)} if isinstance(valeur, bool) else None
    if champ == "devise":
        return {"devise": valeur.strip().upper()} if isinstance(valeur, str) and valeur.strip() else None
    return None  # ventilation : nombres gérés par l'extraction sémantique, pas par l'interpréteur


def _defaut_prudent(champ: str, profil: dict) -> tuple[dict, str | None] | None:
    """Hypothèse prudente à appliquer quand l'utilisateur ne peut pas répondre (choix produit :
    on ne bloque pas, on part sur l'option la plus prudente en l'annonçant si elle est structurante)."""
    if champ == "ca_estime":
        return ({"ca_estime": 0.0}, "Je pars sur l'hypothèse prudente d'un démarrage sous les seuils "
                                    "micro ; tu pourras préciser ton chiffre d'affaires quand tu le connaîtras.")
    if champ == "vend_produits":
        return ({"vend_produits": False}, None)
    if champ == "ventilation":
        ca = float(profil.get("ca_estime") or 0)
        return ({"ca_prestations": ca, "ca_vente": 0.0},
                "Sans répartition précise, je considère prudemment l'ensemble comme des prestations de services.")
    return None


async def _resoudre_question(uid: str, item: dict, message: str, profil: dict) -> tuple[bool, str | None]:
    """Tente de débloquer une question restée sans réponse : interprète, applique la valeur ou
    l'hypothèse prudente. Renvoie (débloqué, note à afficher)."""
    interp = await _interpreter_reponse(item["question"], message)
    if interp["statut"] == "repondu":
        maj = _valeur_vers_profil(item["champ"], interp["valeur"])
        if maj:
            store.patch_profil(uid, maj)
            return True, None
        return False, None
    if interp["statut"] in ("ne_sait_pas", "non_applicable"):
        defaut = _defaut_prudent(item["champ"], profil)
        if defaut:
            store.patch_profil(uid, defaut[0])
            return True, defaut[1]
    return False, None


def _durabilite_indeterminee(profil: dict) -> bool:
    """Vrai si l'analyse juridique ne peut trancher la durabilité faute d'historique N-1."""
    if profil.get("ca_estime") is None:
        return False
    return AJ.analyser(_profil_roadmap(profil)).durabilite == AJ.DURABILITE_INDET


async def _resoudre_durabilite(uid: str, message: str) -> bool:
    """La question de durabilité (CA de l'an dernier) a été posée et reste pendante : interprète la
    réponse, sinon applique l'hypothèse prudente (pas de 2e année de dépassement prouvée -> micro)."""
    interp = await _interpreter_reponse(_QUESTION_DURABILITE, message)
    if interp["statut"] == "repondu" and isinstance(interp["valeur"], bool):
        store.patch_profil(uid, {"ca_n_1_au_dessus_seuil": interp["valeur"]})
        return True
    if interp["statut"] in ("ne_sait_pas", "non_applicable"):
        store.patch_profil(uid, {"ca_n_1_au_dessus_seuil": False})
        return True
    return False


def _a_repondu_assistant(historique: list[dict]) -> bool:
    """Vrai si l'assistant a déjà pris la parole (donc une question a pu être posée au tour précédent)."""
    return any(m["role"] == "assistant" for m in historique)


async def _reformuler(question: str, historique: list[dict], profil: dict) -> str:
    if not historique or len(question.split()) > 10:
        return question
    contexte = "\n".join(f"{m['role']}: {m['content']}" for m in historique[-6:])
    try:
        return (await chat([{"role": "system", "content": "Réécris la dernière question en une seule question fiscale autonome. N'ajoute aucun fait."},
                            {"role": "user", "content": f"Profil: {profil}\nHistorique:\n{contexte}\nQuestion: {question}"}], temperature=0.0, max_tokens=80)).strip()
    except Exception:
        return question


def _profil_roadmap(profil: dict) -> dict:
    """Mappe le profil stocké vers les clés attendues par build_roadmap (ca_estime -> ca_estime_annuel)."""
    return {**profil, "ca_estime_annuel": profil.get("ca_estime", 0)}


def _options_bascule(profil: dict, roadmap: dict | None) -> dict | None:
    """Options cliquables GÉNÉRIQUES proposées par le backend (ici : choix de parcours en bascule).

    Le front ne code aucun cas en dur : il rend toute structure `options` renvoyée ici.
    """
    if not roadmap or roadmap.get("parcours") != "bascule":
        return None
    if profil.get("choix_parcours"):  # choix déjà fait -> plus d'options
        return None
    return {
        "kind": "choix_parcours",
        "prompt": "Tu peux partir sur l'un ou l'autre — que préfères-tu ?",
        "choices": [
            {"label": "Je pars sur la micro-entreprise", "value": "micro"},
            {"label": "Je pars sur une société (EURL/SASU)", "value": "societe"},
        ],
    }


async def respond(session_id: str | None, message: str, mode: str | None = None,
                  action: dict | None = None, uid: str = "demo") -> dict:
    # Le type de session = l'interface (guidance/pedagogue). Le profil est PARTAGÉ par uid.
    stype = mode if mode in ("guidance", "pedagogue") else "guidance"
    sid = store.ensure_session(session_id, uid=uid, type=stype)
    old_history = store.history(sid, limit=12)

    def _paquet(response, sources, roadmap, options, debug):
        if roadmap is not None:
            store.save_roadmap(sid, roadmap=roadmap)  # persistance serveur (chantier 6/5.4)
        store.add_message(sid, "assistant", response, sources)
        return {"session_id": sid, "reponse": response, "sources": sources,
                "profil": store.get_profil(uid), "roadmap": roadmap, "options": options, "debug": debug}

    # --- Action générique (clic sur une option suggérée) : applique puis régénère ---
    if action and action.get("kind") == "choix_parcours":
        profil = store.patch_profil(uid, {"choix_parcours": action.get("value")})
        store.add_message(sid, "user", message)
        result = await guidance.guidance_chat(message, _profil_roadmap(profil))
        return _paquet(result["reponse"], result["sources"], result["roadmap"], None,
                       {"intention": "guidance", "action": action})

    profil_avant = store.get_profil(uid)
    profil = store.patch_profil(uid, await _extraire_profil(message, profil_avant))
    store.add_message(sid, "user", message)

    # Aiguillage : forcé par l'interface (mode), sinon détection (legacy /chat sans mode).
    profilage_en_cours = mode is None and _profilage_actif(old_history)
    creation = (mode == "guidance") or (mode is None and (_est_creation(message, mode) or profilage_en_cours))

    if creation:
        note: str | None = None
        manquantes = _questions_manquantes(profil)
        if manquantes:
            # Anti-boucle : la même question qu'au tour précédent reste sans réponse exploitable ?
            # On interprète alors la réponse (valeur cachée / « je ne sais pas » / non applicable)
            # et on applique une hypothèse prudente plutôt que de re-poser à l'identique.
            pending_avant = _questions_manquantes(profil_avant)
            if (pending_avant and pending_avant[0]["champ"] == manquantes[0]["champ"]
                    and _a_repondu_assistant(old_history)):
                debloque, note = await _resoudre_question(uid, manquantes[0], message, profil)
                if debloque:
                    profil = store.get_profil(uid)
                    manquantes = _questions_manquantes(profil)
        if manquantes:
            reste = len(manquantes)
            jauge = ("Il me reste une information à connaître" if reste == 1
                     else f"Il me reste {reste} informations à connaître") + " pour te proposer une feuille de route. "
            return _paquet(jauge + manquantes[0]["question"], [], None, None,
                           {"intention": "guidance", "question_reformulee": None})

        # Anti-boucle durabilité : la question « CA de l'an dernier ? » était pendante (roadmap
        # précédente indéterminée) et reste non résolue -> interprète, sinon hypothèse prudente.
        if (_durabilite_indeterminee(profil) and _durabilite_indeterminee(profil_avant)
                and _a_repondu_assistant(old_history)):
            if await _resoudre_durabilite(uid, message):
                profil = store.get_profil(uid)

        result = await guidance.guidance_chat(message, _profil_roadmap(profil))
        options = _options_bascule(profil, result["roadmap"])
        reponse = f"{note} {result['reponse']}".strip() if note else result["reponse"]
        return _paquet(reponse, result["sources"], result["roadmap"], options,
                       {"intention": "guidance", "question_reformulee": None})

    # --- Chemin pédagogique (Q&A sourcée) ---
    reformulee = await _reformuler(message, old_history, profil)
    verdict = parcours.verdict_regime({**profil, "ca_estime_annuel": profil.get("ca_estime")})
    result = await pedagogue.answer(reformulee, concerne=None, profil=profil,
                                    historique=old_history[-12:], regime_verdict=verdict)
    return _paquet(result["reponse"], result["sources"], None, None,
                   {"intention": "pedagogue", "question_reformulee": reformulee,
                    "regime_verdict": verdict["parcours"] if verdict else None,
                    "bofip_live_utilise": result.get("bofip_live_utilise", False)})
