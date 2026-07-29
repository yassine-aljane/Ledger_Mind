"""Orchestrateur : graphe LangGraph séquentiel simple
recherche -> génération, avec routing sur les cas d'échec.
"""
from langgraph.graph import StateGraph, END
from .state import AgentState
from .search_agent import search_agent_node
from .email_agent import email_agent_node


def handle_failure_node(state: AgentState) -> AgentState:
    """Noeud terminal appelé quand la recherche échoue (aucun résultat,
    région trop vague, erreur de géocodage)."""
    raw_err = str(state.get("error", "") or "")

    messages = {
        "region_trop_vague": (
            "La ville indiquée n'a pas pu être localisée. "
            "Merci de préciser (ex. ajouter le département ou le code postal)."
        ),
        "aucun_comptable_trouve": (
            "Aucun cabinet comptable n'a été trouvé dans cette zone. "
            "Essayez d'élargir la recherche à une ville voisine."
        ),
    }
    default_msg = "Une erreur est survenue pendant la recherche."

    # Preserve useful details from the agent when we recognize the pattern.
    if raw_err.startswith("erreur_geocodage:"):
        # Example: "erreur_geocodage: Erreur de géocodage pour 'Lyon': ..."
        state["error"] = raw_err.replace("erreur_geocodage:", "Géocodage:").strip()
    else:
        state["error"] = messages.get(raw_err, default_msg)
    return state


def route_after_search(state: AgentState) -> str:
    if state.get("status") == "echec":
        return "echec"
    return "continuer"


def build_graph():
    graph = StateGraph(AgentState)

    graph.add_node("recherche", search_agent_node)
    graph.add_node("generation", email_agent_node)
    graph.add_node("echec", handle_failure_node)

    graph.set_entry_point("recherche")

    graph.add_conditional_edges(
        "recherche",
        route_after_search,
        {"continuer": "generation", "echec": "echec"},
    )

    graph.add_edge("generation", END)
    graph.add_edge("echec", END)

    return graph.compile()


orchestrator = build_graph()
