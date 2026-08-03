"""Agent de génération : rédige un email personnalisé et professionnel par
cabinet trouvé, à partir de la demande de l'utilisateur. Ne fait QUE générer
des brouillons - aucun envoi automatique (validation humaine requise ensuite).

Les appels LLM sont parallélisés (un thread par cabinet) pour éviter le
waterfall N × latence Mistral.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

from langchain_mistralai import ChatMistralAI
from langchain_core.messages import SystemMessage, HumanMessage

from .config import MISTRAL_API_KEY, MODEL_NAME
from .state import AgentState, EmailGenere, Comptable

SYSTEM_PROMPT = """Tu rédiges des emails professionnels en français, au nom de \
l'utilisateur, à destination d'experts-comptables. Consignes strictes :
- Ton professionnel et courtois, jamais familier.
- Sois concis (150-200 mots maximum).
- OBLIGATOIRE : la formule d'appel doit citer le nom du cabinet, pas un simple \
"Bonjour," générique. Exemple de formulation : "Bonjour à l'équipe du cabinet \
[Nom du cabinet]," ou "Madame, Monsieur, Cabinet [Nom du cabinet],". Remplace \
[Nom du cabinet] par le vrai nom fourni dans le message, choisis la \
formulation la plus naturelle selon ce nom.
- Présente brièvement l'utilisateur (statut) puis expose clairement la demande.
- N'invente JAMAIS d'information non fournie (pas de faux SIRET, pas de faux chiffres).
- Termine par une formule de politesse standard et le nom de l'utilisateur.
- Réponds UNIQUEMENT avec le texte de l'email (pas de balises, pas de commentaire).
- Ne mets pas d'objet dans le corps, il sera ajouté séparément."""

_LLM_WORKERS = 4


def _build_prompt(nom_cabinet: str, demande: str, user_info: dict) -> str:
    return f"""Destinataire : cabinet "{nom_cabinet}"

RAPPEL IMPORTANT : ta formule d'appel en tout début d'email doit mentionner \
explicitement "{nom_cabinet}" (ou une forme naturelle abrégée de ce nom si le \
nom complet est trop long/administratif pour une formule de politesse).

Informations sur l'expéditeur :
- Nom : {user_info['nom']}
- Statut : {user_info['statut']}
- Situation fiscale : {user_info['situation_fiscale']}

Demande à transmettre au comptable :
\"\"\"{demande}\"\"\"

Rédige l'email maintenant."""


def _generate_one(
    comptable: Comptable,
    demande: str,
    user_info: dict,
) -> EmailGenere:
    # Un client LLM par thread : ChatMistralAI n'est pas garanti thread-safe.
    llm = ChatMistralAI(model=MODEL_NAME, api_key=MISTRAL_API_KEY, temperature=0.4)
    nom_cabinet = comptable["nom_cabinet"]
    email_dest = comptable.get("email")
    prompt = _build_prompt(nom_cabinet, demande, user_info)
    messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=prompt)]

    try:
        response = llm.invoke(messages)
        corps = response.content.strip()
        statut = "ok" if email_dest else "email_introuvable"
    except Exception as e:
        corps = f"[Erreur de génération: {e}]"
        statut = "erreur_generation"

    return {
        "destinataire": nom_cabinet,
        "email": email_dest,
        "objet": f"Demande d'accompagnement comptable - {user_info['nom']}",
        "corps": corps,
        "statut": statut,
    }


def email_agent_node(state: AgentState) -> AgentState:
    if state.get("status") == "echec":
        return state  # rien à générer si la recherche a échoué

    comptables = state["comptables"]
    if not comptables:
        state["emails_generes"] = []
        state["status"] = "termine"
        return state

    emails_generes: list[EmailGenere | None] = [None] * len(comptables)
    workers = min(_LLM_WORKERS, len(comptables))

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(
                _generate_one,
                c,
                state["demande"],
                state["user_info"],
            ): idx
            for idx, c in enumerate(comptables)
        }
        for fut in as_completed(futures):
            idx = futures[fut]
            try:
                emails_generes[idx] = fut.result()
            except Exception as e:
                c = comptables[idx]
                emails_generes[idx] = {
                    "destinataire": c["nom_cabinet"],
                    "email": c.get("email"),
                    "objet": f"Demande d'accompagnement comptable - {state['user_info']['nom']}",
                    "corps": f"[Erreur de génération: {e}]",
                    "statut": "erreur_generation",
                }

    state["emails_generes"] = [e for e in emails_generes if e is not None]
    state["status"] = "termine"
    return state
