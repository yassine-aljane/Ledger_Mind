"""Clients LLM partagés.

Deux fournisseurs coexistent, par domaine :

  • `app.llm.gemini`  — agent `intake` (branche SIREN) et OCR : import explicite,
    `from app.llm.gemini import chat_json`.
  • `app.llm.mistral` — espace guidance, assistant fiscal et veille : c'est la chaîne du
    prototype `ranyaTra/LedgerMind`, éprouvée sur ce domaine, et elle ne partage pas le
    quota du palier gratuit Gemini.

Les raccourcis exportés ici (`chat_text`, `chat_json_with_system`) pointent sur Mistral :
les agents de guidance n'ont donc pas à connaître le fournisseur.
"""

from app.llm.gemini import chat_json
from app.llm.mistral import MistralIndisponible, chat_json_with_system, chat_text, embed

__all__ = ["chat_json", "chat_json_with_system", "chat_text", "embed", "MistralIndisponible"]
