# agent_NoSiren — Accès / Onboarding (fiscalité française)

> **Périmètre de cette contribution.** Ce dossier apporte les **agents** destinés aux
> utilisateurs **non immatriculés** (pas encore de SIREN) : le **chatbot de guidance** et
> l'**agent pédagogique** (Q&A fiscale sourcée), avec leur moteur de roadmap déterministe,
> leur corpus RAG et leur veille réglementaire.
>
> **Ne sont volontairement pas apportés : le front et la base de données.** Ils sont fusionnés
> au niveau du projet (front commun, base Supabase du dépôt). Voir
> [« Intégration »](#intégration-front--base-de-données) pour les deux points de branchement.

Service **FastAPI** autonome. Deux agents + une veille réglementaire dynamique.
LLM : **Mistral** (API). Embeddings : **modèle open-source local gratuit** (sentence-transformers).
Base vectorielle : **ChromaDB** embarquée (aucun serveur à lancer).

## Deux interfaces conversationnelles (backend & profil PARTAGÉS)

L'application a **deux espaces**, chacun avec son chat et son historique, mais un **magasin de
sessions commun** et un **profil utilisateur partagé** (ce qui est dit dans un espace est connu de
l'autre). L'endpoint unifié est `POST /chat` (`{session_id?, uid?, message, mode?, action?}`) ;
`mode` vaut `guidance` ou `pedagogue`.

1. **Chatbot de guidance** (`mode=guidance`) — **profilage conversationnel** (plus de formulaire),
   panneau profil live éditable, puis **feuille de route déterministe**.
   - Toute la feuille de route (étapes, ordre, régime, seuils, liens, coûts) vient du moteur
     **`build_roadmap()`** — 100 % déterministe, **aucun appel MCP/réseau** (lit `data/seuils.yaml`).
   - Le verdict porte `regime` **et** `durabilite` (`eligible_stable | depassement_ponctuel |
     depassement_durable | indetermine`). Le LLM ne rédige qu'un **court message d'accompagnement**
     (2–4 phrases, validé côté code).
   - Roadmap interactive (phases, badges, durée/coût **sourcés**, cases cochées **persistées côté
     serveur**) + **PDF créatif** (`/roadmap`, `/roadmap/pdf`).
   - Zone d'arbitrage micro/société : **options cliquables génériques** renvoyées par le backend.

2. **Agent pédagogique** (`mode=pedagogue`, aussi `/ask`) — Q&A fiscale **ancrée sur le corpus
   (RAG)**, **cite ses sources**, refuse d'inventer, reformule les questions de suivi, et s'aligne
   sur le **verdict déterministe** du régime (jamais de contradiction avec la roadmap).

3. **Veille dynamique** (`/veille/run`, `/veille/last`) — corpus **vivant** (Légifrance/PISTE,
   BOFiP, sources web, DGFiP/BOSS via MCP) résumé/ré-ingéré, **plus** un **contrôle des seuils** de
   `data/seuils.yaml` contre les sources officielles (signale tout écart, sans écraser le fichier).

### Endpoints d'historique & de mémoire

| Endpoint | Rôle |
|---|---|
| `GET /conversations?uid&type` | Liste des conversations (filtrées par interface) |
| `GET /chat/{id}` | Conversation complète + profil + roadmap + cases cochées |
| `PATCH /chat/{id}/rename` · `DELETE /chat/{id}` | Renommer / supprimer |
| `GET/PATCH/DELETE /profil/{uid}` | Profil **partagé** par utilisateur |
| `GET/PUT /roadmap/state/{id}` | État coché de la roadmap **persisté** avec la conversation |

Sessions, messages (avec sources et horodatage), profil et état de roadmap sont persistés en
**SQLite** (`sqlite3` de la stdlib, aucune dépendance), avec purge des sessions anciennes.

## Intégration (front & base de données)

**Front — non fourni.** Les agents n'exposent que du JSON ; l'UI est celle du projet commun.
Contrat côté client : un seul endpoint conversationnel `POST /chat`
(`{session_id?, uid?, message, mode, action?}`), `mode` valant `guidance` ou `pedagogue`.
La réponse porte le texte, les **sources citées**, le **profil** mis à jour, la **roadmap**
structurée et, en zone d'arbitrage, des **options cliquables** génériques (`{kind, value}`)
que le front rend en boutons sans rien connaître de la logique fiscale.

**Base de données — à remplacer.** `app/memory/store.py` est une implémentation **SQLite de
référence**, fournie pour que le dossier tourne seul et pour **documenter le schéma attendu**.
Elle est à remplacer par la couche commune (Supabase) : c'est le **seul** module de persistance,
importé en deux endroits — [`app/agents/conversation.py`](app/agents/conversation.py) et
[`app/main.py`](app/main.py). Les agents eux-mêmes n'écrivent jamais en base directement.

Interface à réimplémenter, à l'identique en signatures :

| Domaine | Fonctions |
|---|---|
| Sessions | `ensure_session(session_id?, uid, type)`, `session_meta(id)`, `list_sessions(uid, type?)`, `rename_session(id, title)`, `delete_session(id)`, `purge_expirees()` |
| Messages | `add_message(session_id, role, content, sources?)`, `history(session_id, limit?)` |
| Profil (partagé par `uid`) | `get_profil(uid)`, `get_profil_by_session(session_id)`, `patch_profil(uid, valeurs)`, `clear_profil_field(uid, field)` |
| Roadmap | `save_roadmap(session_id, roadmap?, checked?)`, `get_roadmap(session_id)` |

Deux règles à conserver lors du portage, car des tests en dépendent
([`tests/test_memory.py`](tests/test_memory.py)) :
`type` de session vaut `guidance` ou `pedagogue` (l'historique est filtré par espace), et le
**profil est partagé par `uid`** entre les deux espaces — ce qui est dit dans l'un est connu de
l'autre. La normalisation déterministe du profil (`CA total = prestations + ventes`, etc.) doit
rester **côté code**, pas côté LLM.

## Démarrage

```bash
python -m venv .venv && source .venv/bin/activate    # Windows : .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                  # puis renseigner MISTRAL_API_KEY
python -m scripts.seed_corpus                         # amorce le corpus (télécharge les sources)
uvicorn app.main:app --reload --port 8000
```

Docs interactives : http://localhost:8000/docs

> Premier lancement : le modèle d'embedding local (~1–2 Go) se télécharge une fois.
> Pas de GPU nécessaire.

## Clés à obtenir (toutes gratuites)

- **Mistral** : https://console.mistral.ai → `MISTRAL_API_KEY`. Modèle par défaut
  `mistral-small-latest` (économique) ; `open-mistral-nemo` est encore plus léger.
- **PISTE / Légifrance** (optionnel, pour la veille par API) : https://piste.gouv.fr →
  `PISTE_CLIENT_ID` / `PISTE_CLIENT_SECRET`. Sans ces clés, la veille fonctionne quand même
  via le scraping seul.

## Endpoints

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/ask` | Q&A fiscal RAG. Body : `{question, concerne?}` |
| POST | `/guidance` | Chat guidance + roadmap. Body : `{message, profil?}` |
| POST | `/roadmap` | Roadmap JSON (checklist). Body : `{profil}` |
| POST | `/roadmap/pdf` | Roadmap PDF téléchargeable. Body : `{profil}` |
| POST | `/veille/run` | Déclenche un cycle de veille |
| GET | `/veille/last` | Dernier rapport de veille |
| GET | `/health` | État + nombre de chunks du corpus |

### Exemple

```bash
curl -X POST localhost:8000/ask -H "Content-Type: application/json" \
  -d '{"question":"Je reçois des produits gratuits de marques, dois-je les déclarer ?","concerne":"influenceur"}'

curl -X POST localhost:8000/roadmap/pdf -H "Content-Type: application/json" \
  -d '{"profil":{"activite":"créatrice Instagram","ca_estime_annuel":45000,"recoit_cadeaux":true}}' \
  --output roadmap.pdf
```

## Sources via serveurs MCP

La couche sources est exposée en **3 serveurs MCP** réutilisables (dans `mcp_servers/`), que
l'app consomme via un **client MCP** (`app/mcp/client.py`). Avantage : n'importe quel futur
agent (Agent 2 qualification, etc.) appelle les mêmes serveurs sans dupliquer le code.

| Serveur MCP | Outils | Accès |
|---|---|---|
| `legifrance` | `legifrance_search`, `code_article` | API PISTE (lois, décrets, **CGI**, **Code conso**) |
| `bofip` | `bofip_search`, `bofip_fetch` | API Opendatasoft `bofip-vigueur` (doctrine opposable, **sans clé**) |
| `web-sources` | `list_sources`, `fetch_source`, `check_updates` | URSSAF, DGCCRF, **ARPP**, impots.gouv, service-public |
| `entreprises` | `rechercher_entreprise`, `inpi_guichet_unique` | **API recherche-entreprises** (Sirene **INSEE**), liens **INPI** |
| `docs-officiels` | `sp_search`, `fetch_page`, `fetch_pdf`, `boss_fetch`, `catalogue` | **Service-Public** (API DILA), **DGFiP**/impots, actualités, **lois de finances**, **FAQ**, **guides & notices PDF**, **BOSS** |

- `GET /mcp/tools` — découvre les outils exposés par chaque serveur.
- `POST /mcp/ingest-bofip?requete=...` — recherche BOFiP et ingère les résultats dans le corpus.
- L'agent pédagogique fait un **repli BOFiP en direct** quand le corpus local est faible sur une
  question (score < 0,55), pour ancrer la réponse sur la doctrine opposable.
- La **veille** (`app/veille/scheduler.py`) consomme les 3 serveurs MCP puis ré-ingère.

Les serveurs sont lancés automatiquement en sous-processus (transport stdio) par le client ;
rien à démarrer manuellement. `A2A` (communication entre agents) est laissé pour l'Agent 2.

## Sources du corpus (fiscalité FR)

Amorçage statique via `data/sources.yaml` (`scripts/seed_corpus.py`), priorisé par **autorité**
au retrieval : Légifrance (lois/décrets) > BOFiP / URSSAF / impots.gouv.fr > guides / ARPP.
Le reste arrive dynamiquement par MCP (BOFiP, CGI, Code conso, actualités).

## Fraîcheur (anti-info-périmée)

Chaque chunk porte `date_publication`, `date_effet` et `date_verification`. Si une source
dépasse `FRESHNESS_MAX_DAYS` (120 j par défaut), l'agent pédagogique ajoute un avertissement
de fraîcheur dans sa réponse (`avertissement_fraicheur: true`).

## Notes

- Modèle « aide à la compréhension », **pas de conseil fiscal engageant** : les prompts
  imposent l'orientation vers les sources officielles / un expert-comptable.
- CORS ouvert (`allow_origins=["*"]` dans `app/main.py`) pour faciliter le branchement du front
  commun en développement — **à restreindre** avant toute mise en production.
- Tests : `pytest tests` depuis ce dossier (roadmap déterministe, PDF, persistance).
