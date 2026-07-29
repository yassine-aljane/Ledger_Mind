"""Client MCP : lance les serveurs de sources en sous-processus (stdio) et appelle leurs outils.

Un seul point d'entrée pour tous les agents. Les serveurs sont déclarés dans SERVERS ;
`call_tool` ouvre une session, appelle l'outil, renvoie le résultat structuré et referme.

Pourquoi MCP plutôt que des imports directs : les sources deviennent des services réutilisables
et interchangeables. Le jour où l'Agent 2 (qualification) a besoin de BOFiP, il appelle le même
serveur `bofip` sans dupliquer le code, et on peut remplacer un serveur (ex héberger bofip-mcp
en distant) sans toucher aux agents.
"""
from __future__ import annotations

import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from app.config import settings

_PYTHON = sys.executable
# Racine du projet (…/app/mcp/client.py -> parents[2]). On résout les scripts serveurs
# en chemins ABSOLUS pour que le lancement fonctionne quel que soit le répertoire courant
# du backend (uvicorn lancé depuis un autre dossier ou l'IDE -> plus de « indisponible »).
_BASE_DIR = Path(__file__).resolve().parents[2]


def _srv(script: str) -> list[str]:
    return [str(_BASE_DIR / "mcp_servers" / script)]


SERVERS = {
    "legifrance": _srv("legifrance_server.py"),
    "bofip": _srv("bofip_server.py"),
    "web-sources": _srv("web_sources_server.py"),
    "entreprises": _srv("entreprises_server.py"),
    "docs-officiels": _srv("docs_officiels_server.py"),
}


@asynccontextmanager
async def _session(server: str):
    if server not in SERVERS:
        raise ValueError(f"Serveur MCP inconnu : {server}")
    env = os.environ.copy()  # transmet PISTE_CLIENT_ID/SECRET aux serveurs
    env.setdefault("PYTHONUTF8", "1")            # stdio MCP en UTF-8 (Windows : évite le mojibake cp1252)
    env.setdefault("PYTHONIOENCODING", "utf-8")
    # pydantic-settings lit .env dans l'objet settings mais pas dans os.environ :
    # on propage explicitement les clés PISTE aux sous-processus MCP (serveur legifrance).
    if settings.piste_client_id and settings.piste_client_secret:
        env.setdefault("PISTE_CLIENT_ID", settings.piste_client_id)
        env.setdefault("PISTE_CLIENT_SECRET", settings.piste_client_secret)
    params = StdioServerParameters(
        command=_PYTHON,
        args=SERVERS[server],
        env=env,
        cwd=str(_BASE_DIR),  # répertoire de travail = racine projet (robustesse chemins relatifs)
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


async def list_tools(server: str) -> list[dict]:
    async with _session(server) as s:
        resp = await s.list_tools()
        return [{"name": t.name, "description": t.description} for t in resp.tools]


async def call_tool(server: str, tool: str, arguments: dict) -> dict:
    """Appelle un outil MCP et renvoie le contenu structuré (JSON) ou le texte."""
    async with _session(server) as s:
        result = await s.call_tool(tool, arguments=arguments)
        # FastMCP renvoie le retour de fonction dans structuredContent quand c'est un dict
        if getattr(result, "structuredContent", None):
            return result.structuredContent
        # Sinon on concatène les blocs texte. Les serveurs FastMCP (SDK 1.2) sérialisent
        # leur dict de retour en JSON dans un bloc texte : on le reparse en dict.
        textes = [c.text for c in result.content if getattr(c, "type", "") == "text"]
        brut = "\n".join(textes)
        if not brut:
            return {}
        try:
            parsed = json.loads(brut)
            if isinstance(parsed, dict):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass
        return {"texte": brut}
