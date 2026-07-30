"""Schéma de requête `/api/guidance/chat` (couche API, avant `conversation.respond`).

Régression : le clic sur une chip de suggestion (`pickChip` côté front) envoie une action
`{kind: "reponse_champ", champ, valeurs}` SANS `value` — `ChatOption.value` était `str`
obligatoire, ce qui faisait échouer la validation Pydantic (HTTP 422) avant même d'atteindre
la logique de conversation, alors que celle-ci gère cette forme d'action depuis le chantier des
chips de profilage rapide.
"""

from app.api.guidance import ChatRequest


def test_reponse_champ_action_sans_value_est_acceptee():
    payload = {
        "session_id": None,
        "message": "Vente de produits",
        "mode": "guidance",
        "action": {"kind": "reponse_champ", "champ": "vend_produits", "valeurs": {"vend_produits": True}},
    }
    req = ChatRequest.model_validate(payload)
    assert req.action is not None
    assert req.action.model_dump() == {
        "kind": "reponse_champ",
        "value": None,
        "champ": "vend_produits",
        "valeurs": {"vend_produits": True},
    }


def test_choix_parcours_action_avec_value_reste_acceptee():
    payload = {
        "message": "Freelance",
        "action": {"kind": "choix_parcours", "value": "freelance"},
    }
    req = ChatRequest.model_validate(payload)
    assert req.action.value == "freelance"
    assert req.action.champ is None
