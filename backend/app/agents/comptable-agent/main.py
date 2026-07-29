"""Point d'entrée CLI.

Exemple :
    python main.py --ville "Lyon" \\
        --demande "Je suis en micro-entreprise BNC, j'ai besoin d'aide pour ma première déclaration de TVA." \\
        --nom "Fourat B." --statut "Micro-entreprise (BNC)" \\
        --situation "Première année d'activité, régime de la franchise en base de TVA"
"""
import argparse
from orchestrator import orchestrator
from state import AgentState


def run(ville: str, demande: str, nom: str, statut: str, situation: str) -> AgentState:
    initial_state: AgentState = {
        "ville": ville,
        "demande": demande,
        "user_info": {"nom": nom, "statut": statut, "situation_fiscale": situation},
        "comptables": [],
        "emails_generes": [],
        "error": None,
        "status": "en_cours",
    }
    return orchestrator.invoke(initial_state)


def print_result(result: AgentState) -> None:
    if result.get("status") == "echec":
        print(f"\n❌ Échec : {result.get('error')}\n")
        return

    print(f"\n✅ {len(result['emails_generes'])} brouillon(s) généré(s) :\n")
    for e in result["emails_generes"]:
        print("=" * 70)
        print(f"Destinataire : {e['destinataire']}")
        print(f"Email        : {e['email'] or '⚠️  non trouvé - à compléter manuellement'}")
        print(f"Statut       : {e['statut']}")
        print(f"Objet        : {e['objet']}")
        print("-" * 70)
        print(e["corps"])
        print("=" * 70)
        print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agent de recherche de comptables + génération d'emails")
    parser.add_argument("--ville", required=True)
    parser.add_argument("--demande", required=True)
    parser.add_argument("--nom", required=True)
    parser.add_argument("--statut", required=True)
    parser.add_argument("--situation", required=True)
    args = parser.parse_args()

    result = run(args.ville, args.demande, args.nom, args.statut, args.situation)
    print_result(result)
