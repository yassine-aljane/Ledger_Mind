"""Sépare les « jeux de déclarations » des « déclarations préparées ».

Les deux agents (`app.agents.declaration` au singulier et `app.agents.declarations` au
pluriel) écrivaient dans la même collection `declarations_generees` avec des schémas
incompatibles. `/api/declaration` renvoyait donc parfois un jeu de brouillons — sans
`total_ca_declare` ni `statut` — que le tableau de bord tentait de formater.

Ce script déplace les documents intrus vers `jeux_declarations` (la nouvelle collection
de l'agent pluriel). Copie d'abord, vérification, suppression ensuite : rien n'est
supprimé tant que la copie n'est pas confirmée.

    cd backend && ../.venv/Scripts/python.exe scripts/migrer_jeux_declarations.py
"""

from __future__ import annotations

from app.core.mongo import get_db

# Les déclarations préparées ont toujours ce champ ; les jeux de brouillons, jamais.
MARQUEUR = "total_ca_declare"


def main() -> None:
    db = get_db()
    source = db["declarations_generees"]
    cible = db["jeux_declarations"]

    intrus = list(source.find({MARQUEUR: {"$exists": False}}))
    print(f"documents à déplacer : {len(intrus)}")
    if not intrus:
        print("rien à faire.")
        return

    for doc in intrus:
        doc.pop("_id", None)
        cible.update_one({"uid": doc["uid"], "id": doc["id"]}, {"$set": doc}, upsert=True)

    copies = sum(1 for d in intrus if cible.find_one({"uid": d["uid"], "id": d["id"]}))
    print(f"copies vérifiées : {copies}/{len(intrus)}")
    if copies != len(intrus):
        print("copie incomplète — aucune suppression, la source reste intacte.")
        return

    for doc in intrus:
        source.delete_one(
            {"uid": doc["uid"], "id": doc["id"], MARQUEUR: {"$exists": False}}
        )

    print(f"declarations_generees : {source.count_documents({})} document(s)")
    print(f"jeux_declarations     : {cible.count_documents({})} document(s)")
    print(f"intrus restants       : {source.count_documents({MARQUEUR: {'$exists': False}})}")


if __name__ == "__main__":
    main()
