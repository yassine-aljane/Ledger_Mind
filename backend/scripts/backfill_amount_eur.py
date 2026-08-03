"""Backfill ponctuel : convertit en euros les pièces capturées qui n'ont pas de
contre-valeur, faute d'une source de taux couvrant leur devise à l'époque.

La BCE ne publie que 30 devises : les factures et virements libellés en TND,
MAD, DZD… ont été enregistrés avec `amount_eur` à `null`. Depuis l'ajout d'une
source élargie (voir app/agents/capture/app/fx.py), ces devises sont
convertibles — ce script rattrape le passé.

Chaque pièce est convertie au taux de SA PROPRE date (émission pour une
facture, exécution pour un virement), jamais au taux du jour : la contre-valeur
doit refléter le moment de l'opération.

Idempotent : les pièces déjà converties sont ignorées, le script peut être
relancé sans risque. Une pièce sans date ou sans montant reste intouchée.

Usage (depuis la racine du dépôt, venv actif) :
    python -m backend.scripts.backfill_amount_eur           # aperçu, n'écrit rien
    python -m backend.scripts.backfill_amount_eur --apply   # applique
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pymongo import MongoClient  # noqa: E402

from app.agents.capture.app import fx  # noqa: E402
from app.agents.capture.app.db import Database  # noqa: E402
from app.config import settings  # noqa: E402


def _traiter(db: Database, collection, champ: str, date_key: str, montant_key: str, apply: bool):
    """Reprend une collection. `champ` : 'invoice' ou 'transfer'."""
    convertis = 0
    ignores = 0
    echecs: list[str] = []

    for doc in collection.find({}):
        corps = doc.get(champ) or {}
        if corps.get("amount_eur") is not None:
            continue  # déjà converti

        montant = corps.get(montant_key)
        devise = corps.get("currency")
        date = corps.get(date_key)
        doc_id = doc.get("document_id", "?")

        if montant is None or not devise or not date:
            ignores += 1
            continue

        amount_eur, taux, source = fx.enrich_amount_eur(db, montant, devise, date)
        if amount_eur is None:
            echecs.append(f"{doc_id} ({devise} du {date})")
            continue

        print(f"  {doc_id} : {montant} {devise} -> {amount_eur} EUR (taux {taux}, {source})")
        if apply:
            collection.update_one(
                {"_id": doc["_id"]},
                {
                    "$set": {
                        f"{champ}.amount_eur": amount_eur,
                        f"{champ}.exchange_rate": taux,
                        f"{champ}.rate_date": date,
                        f"{champ}.rate_source": source,
                    }
                },
            )
        convertis += 1

    return convertis, ignores, echecs


def backfill(apply: bool) -> None:
    client = MongoClient(settings.mongo_uri)
    db = Database(client, settings.mongo_db_name)

    print(f"Base : {settings.mongo_db_name} — mode {'ÉCRITURE' if apply else 'APERÇU'}\n")

    print("Factures :")
    f_ok, f_ign, f_ko = _traiter(db, db.invoices, "invoice", "issue_date", "total_ttc", apply)
    print("\nVirements :")
    v_ok, v_ign, v_ko = _traiter(db, db.virements, "transfer", "execution_date", "amount", apply)

    print("\n--- Bilan ---")
    print(f"  converties : {f_ok} facture(s), {v_ok} virement(s)")
    print(f"  ignorées (montant, devise ou date absents) : {f_ign + v_ign}")
    if f_ko or v_ko:
        print(f"  non convertibles ({len(f_ko) + len(v_ko)}) — devise inconnue des deux sources :")
        for ref in (f_ko + v_ko)[:20]:
            print(f"    - {ref}")
    if not apply and (f_ok or v_ok):
        print("\nAperçu uniquement. Relancez avec --apply pour écrire.")


if __name__ == "__main__":
    backfill(apply="--apply" in sys.argv)
