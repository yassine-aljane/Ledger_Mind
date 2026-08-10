"""Signaux de conformité apparente — un écart est une QUESTION à vérifier, jamais un verdict.

Mêmes règles que l'agent d'insights du projet : ni le mot « fraude », ni « infraction », ni
aucune accusation. Un signal ne fait que pointer un écart chiffré et invite à le vérifier.
"""

from __future__ import annotations

from app.agents.rapport.schemas import SignalConformite

# Écart au-delà duquel une divergence entre le CA déclaré (profil) et le CA réellement facturé
# sur la période mérite d'être signalée — seuil de bon sens, pas une règle légale.
_SEUIL_ECART_DECLARATIF = 0.30


def detecter_signaux(brut: dict, ca_declare_annuel: float | None) -> list[SignalConformite]:
    signaux: list[SignalConformite] = []

    if ca_declare_annuel and ca_declare_annuel > 0:
        # Comparaison prudente : le CA déclaré est annuel, celui de la période ne l'est pas
        # forcément — on ne conclut jamais, on pose la question si l'écart est important.
        ecart = abs(brut["total_ht"] - ca_declare_annuel) / ca_declare_annuel
        if brut["total_ht"] > ca_declare_annuel * (1 + _SEUIL_ECART_DECLARATIF):
            signaux.append(SignalConformite(
                label="Chiffre d'affaires facturé au-dessus de l'estimation déclarée",
                question=(
                    f"Le total facturé sur cette période ({brut['total_ht']:.0f} €) dépasse "
                    f"l'estimation de chiffre d'affaires annuel déclarée ({ca_declare_annuel:.0f} €). "
                    "Vaut-il la peine de mettre à jour cette estimation dans votre profil ?"
                ),
            ))

    # Un avantage en nature visible dans Justificatifs mais absent de l'assiette doit se
    # dire : sinon le total du rapport ne se raccroche pas à ce que l'utilisateur voit,
    # et il conclura à une erreur de calcul plutôt qu'à une pièce incomplète.
    for ecarte in brut.get("cadeaux_ecartes") or []:
        signaux.append(SignalConformite(
            label="Avantage en nature non compté dans les recettes",
            question=(
                f"« {ecarte['libelle']} » n'a pas été retenu dans les recettes de la période "
                f"({ecarte['motif']}). Un cadeau reçu en contrepartie d'une prestation est un "
                "revenu imposable : voulez-vous compléter cette pièce pour qu'elle entre au "
                "calcul ?"
            ),
        ))

    return signaux
