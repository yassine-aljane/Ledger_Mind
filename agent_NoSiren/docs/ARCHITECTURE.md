# LedgerMind — Architecture & documentation technique

Agent 1 (Accès / Onboarding) — assistant fiscal génératif pour créateurs de contenu et
freelances, **cadre fiscal français**. Document de référence sur l'architecture, la stack, les
modèles, les workflows de génération de réponse, et **en détail la partie RAG** et ses sources de
données (serveurs MCP).

---

## 1. Principe directeur

> **Les faits sont déterministes ; le LLM ne fait que rédiger.**

- Toute **décision de régime**, tout **seuil**, **taux**, **étape**, **lien**, **coût** provient
  d'un moteur déterministe versionné (`data/seuils.yaml` → `decide_regime()` → `build_roadmap()`).
  Aucun de ces faits n'est inventé ni « décidé » par le modèle.
- Le LLM sert à trois choses seulement : **rédiger** (réponses pédagogiques ancrées sur des
  sources, court message d'accompagnement de roadmap), **comprendre** (extraction sémantique du
  profil, reformulation des questions), **résumer** (veille). Chaque sortie est **validée** ou
  **contrainte** par du code.
- **RAG-first** pour l'agent pédagogique : aucune affirmation fiscale sans extrait de source
  officielle. Refus honnête si aucune source fiable.

---

## 2. Stack technique

| Couche | Technologie | Rôle |
|---|---|---|
| API / backend | **FastAPI** (ASGI, `uvicorn`) | endpoints REST, orchestration |
| LLM (génération) | **Mistral** API — `mistral-small-latest` | rédaction, extraction, résumé |
| Embeddings (RAG) | **`intfloat/multilingual-e5-large`** (local, `sentence-transformers`) | vectorisation FR, **gratuit**, hors-ligne. Repli optionnel API `mistral-embed` |
| Base vectorielle | **ChromaDB** embarquée (`PersistentClient`, HNSW cosine) | corpus RAG persistant, aucun serveur |
| Sources officielles | **5 serveurs MCP** (stdio) | Légifrance/PISTE, BOFiP, web-sources, entreprises, docs-officiels |
| Mémoire / sessions | **SQLite** (`sqlite3` stdlib) | sessions, messages, profil partagé, état roadmap |
| Planification | **APScheduler** (`AsyncIOScheduler`) | veille réglementaire quotidienne |
| PDF | **fpdf2** (pur Python) ou **WeasyPrint** (si GTK) | export roadmap créatif |
| Frontend | **React 18 + Babel standalone** via CDN, **sans build** ; `marked` + `DOMPurify` | 2 interfaces conversationnelles |
| Parsing / scraping | `httpx`, `beautifulsoup4` + `lxml`, `pdfminer.six` | fetch + nettoyage HTML/PDF |

Contraintes assumées : **aucune dépendance lourde superflue, aucun service externe** (hors API
Mistral et sources officielles publiques), **pas de build front**.

---

## 3. Modèles utilisés

- **`mistral-small-latest`** (API Mistral, `POST /v1/chat/completions`) — configurable via
  `MISTRAL_MODEL`. Utilisé pour :
  - la **rédaction pédagogique** (RAG) — température `0.0`, `max_tokens≈2000` ;
  - le **message d'accompagnement** de la roadmap — température `0.2`, `max_tokens≈220`, sortie validée ;
  - l'**extraction sémantique** du profil — température `0.0`, `json_mode=True` ;
  - la **reformulation** des questions de suivi — température `0.0`, `max_tokens≈80` ;
  - le **résumé/classement** des nouveautés de veille — `json_mode=True`.
- **`intfloat/multilingual-e5-large`** (local, `sentence-transformers`) — embeddings des requêtes
  et des documents. Convention e5 : préfixes `query:` / `passage:`, vecteurs **normalisés**
  (cosine). Aucun coût, fonctionne hors-ligne. Repli API `mistral-embed` si
  `EMBEDDINGS_PROVIDER=mistral`.

---

## 4. Vue d'ensemble

```
                         ┌──────────────────────────────────────────────┐
   Navigateur (React CDN)│  Interface GUIDANCE     Interface PÉDAGOGUE   │
   sans build            │  (profilage + roadmap)  (Q&A fiscale sourcée) │
                         └───────────────┬──────────────────────────────┘
                                         │  HTTP JSON  (POST /chat, mode=guidance|pedagogue)
                    ┌────────────────────▼─────────────────────────────────────────┐
                    │                     FastAPI  (app/main.py)                     │
                    │                                                                │
                    │   app/agents/conversation.py  ─ ORCHESTRATEUR                  │
                    │     • extraction sémantique du profil (Mistral JSON)           │
                    │     • aiguillage guidance / pédagogue                          │
                    │     • gating de complétude (jamais de roadmap incomplète)      │
                    └───────┬───────────────────────────┬───────────────────────────┘
             CHEMIN RUNTIME │                           │ CHEMIN RAG (sourcé)
        (aucun réseau)      │                           │
      ┌─────────────────────▼─────────┐      ┌──────────▼───────────────────────────┐
      │  MOTEUR DÉTERMINISTE          │      │  agent PÉDAGOGUE (app/agents/         │
      │  app/roadmap/parcours.py      │      │  pedagogue.py) + RAG                  │
      │   decide_regime() ← seuils.yaml│      │   retriever → ChromaDB (e5)          │
      │   build_roadmap() → JSON       │      │   tri autorité+fraîcheur             │
      │   (phases, étapes, legal_src,  │      │   repli BOFiP live si score faible   │
      │    durabilite, comparatif…)    │      │   Mistral rédige (cite les sources)  │
      └──────────┬─────────────────────┘      └──────────┬───────────────────────────┘
                 │ accompagnement (Mistral, 2–4 phrases validées)                     │
                 ▼                                        ▼
      app/roadmap/pdf.py (PDF)              app/rag/* (ingest, vectorstore, retriever)
                                                          ▲
   app/memory/store.py (SQLite : sessions, messages, profil partagé, état roadmap)
                                                          │ ingestion / repli live
   ┌──────────────────────────────────────────────────────┴─────────────────────────┐
   │            HORS LIGNE — Veille (APScheduler) + 5 SERVEURS MCP (stdio)            │
   │  legifrance · bofip · web-sources · entreprises · docs-officiels                │
   │  → enrichissent le corpus + contrôlent seuils.yaml (sans écraser)               │
   └─────────────────────────────────────────────────────────────────────────────────┘
```

**Séparation clé (RUNTIME vs HORS LIGNE)** : la génération de roadmap ne fait **aucun appel MCP /
réseau** — elle lit `seuils.yaml`. Les serveurs MCP sont sollicités **hors du chemin critique**
(veille périodique, enrichissement corpus, repli BOFiP en direct).

---

## 5. Les deux interfaces & endpoints

Un **backend et un magasin de sessions communs** ; le **profil utilisateur est partagé** (clé
`uid`) entre les deux espaces — l'utilisateur ne répète jamais son activité/CA.

| Endpoint | Rôle |
|---|---|
| `POST /chat` | `{session_id?, uid?, message, mode?, action?}` → réponse + sources + profil + roadmap + options |
| `GET /conversations?uid&type` | liste des conversations, filtrées par interface |
| `GET /chat/{id}` | conversation complète + profil + roadmap + cases cochées |
| `PATCH /chat/{id}/rename` · `DELETE /chat/{id}` | renommer / supprimer |
| `GET/PATCH/DELETE /profil/{uid}` | profil **partagé** (lecture / édition / effacement d'un champ) |
| `GET/PUT /roadmap/state/{id}` | état coché de la roadmap **persisté** côté serveur |
| `POST /roadmap` · `POST /roadmap/pdf` | roadmap déterministe JSON / PDF |
| `POST /ask` | agent pédagogique direct (compat) |
| `POST /guidance` | guidance directe (compat) |
| `POST /veille/run` · `GET /veille/last` | veille |
| `GET /mcp/tools` · `POST /mcp/ingest-bofip` | découverte MCP / ingestion à la demande |

`mode` = `guidance` (profilage + roadmap) ou `pedagogue` (Q&A). Sans `mode`, l'orchestrateur
**détecte l'intention** (legacy).

---

## 6. Comment chaque type de réponse est généré (workflows)

### 6.1 Question fiscale → agent pédagogique (RAG sourcé)

```
message ──▶ extraction sémantique du profil (partagé)
        ──▶ reformulation en question autonome (si elliptique, ex. « et si je dépasse ? »)
        ──▶ RAG : retriever.search(question, k=8)              [voir §7]
        ──▶ si meilleure similarité < 0.80 : repli BOFiP EN DIRECT (MCP bofip_search)
        ──▶ verdict déterministe injecté (decide_regime) comme CONTRAINTE de régime
        ──▶ Mistral rédige (temp 0) en citant [Source — Titre], refuse si aucune source
        ──▶ réponse + sources (score, fraîcheur) + avertissements
```

Garde-fous : citations obligatoires, **refus honnête** sans source fiable, avertissement de
fraîcheur, la **mémoire n'est jamais une source**, et le régime affirmé ne peut pas contredire
`decide_regime` (position déterministe injectée dans le prompt).

### 6.2 Profilage conversationnel (interface guidance)

```
message ──▶ _extraire_brut (Mistral json_mode)  → composantes brutes
        ──▶ _reconcilier (DÉTERMINISTE)          → profil normalisé
              • négations, synonymes/argot, montants + devise
              • cadeaux = rémunération EN NATURE d'une prestation (jamais une vente)
              • CA total = prestations + ventes  (annualisation déterministe)
        ──▶ gating : _questions_manquantes(profil)
              tant que non vide → pose UNE question, N'APPELLE PAS build_roadmap
        ──▶ dès complétude → build_roadmap + accompagnement
```

Le **panneau profil** (cartes/chips) se remplit progressivement ; chaque carte est éditable /
supprimable. Aucun formulaire. Devise ≠ EUR → **conservée** + demande de conversion (jamais de
substitution silencieuse).

### 6.3 Génération de roadmap (déterministe + accompagnement)

```
profil complet ──▶ decide_regime(profil)                          [§8]
                     → parcours (micro | societe | bascule)
                     → durabilite (eligible_stable | depassement_ponctuel |
                                    depassement_durable | indetermine)
               ──▶ build_roadmap → JSON : phases, étapes (titre, badge, durée, coût
                     SOURCÉ, lien), seuils_profil, legal_sources, comparatif (bascule),
                     mixte, prorata, fraîcheur
               ──▶ Mistral : message d'accompagnement 2–4 phrases
                     • ne cite AUCUN seuil/étape/source, pas d'emoji/markdown
                     • VALIDÉ côté code (rejet € / % / liste / >4 phrases → régénère 1×)
                     • JSON absent → phrase exacte, sans appel LLM
```

Roadmap écran **et** PDF proviennent du **même JSON**. L'export PDF est créatif (couverture,
récapitulatif, phases, encadrés d'étape, palette produit).

### 6.4 Options cliquables (zone de bascule micro/société)

Le backend renvoie un objet générique `options {kind, prompt, choices:[{label, value}]}`. Le clic
envoie le libellé comme message + une `action {kind, value}` ; l'orchestrateur applique le choix
(`choix_parcours`) et **régénère** la roadmap. Mécanisme générique, **aucun cas en dur** côté front.

---

## 7. RAG — architecture, workflow et sources

### 7.1 Architecture RAG

```
INGESTION (hors ligne)                          INTERROGATION (runtime)
─────────────────────                           ───────────────────────
source officielle (MCP / scripts)               question utilisateur
      │ nettoyage HTML/PDF                             │ embed e5 « query: »
      │ _chunk() : découpe par ARTICLE                 ▼
      │   juridique (regex) sinon paquets ~1600c   ChromaDB.query(cosine, k, where=concerne)
      │ embed e5 « passage: » (normalisé)              │  documents + metadatas + distances
      ▼                                                ▼
ChromaDB.upsert(ids, embeddings,                 rerank : score = (1 - distance) × poids_autorité
  documents, metadatas)                                │   autorité 1→1.0 · 2→0.9 · 3→0.75
  métadonnées : source, titre, url, type_doc,          │ is_stale ? (date_verif > freshness_max_days)
  autorite(1-3), date_publication, date_effet,         ▼
  date_verification, concerne                     hits triés par score → top-k
```

- **Chunking** (`app/rag/ingest.py`) : découpe par **article de loi** (`Article L…`, `Art. …`) —
  idéal pour les textes juridiques — sinon fenêtres de ~1600 caractères. `id = sha1(url|titre)_i`
  (upsert idempotent, pas de doublon).
- **Embeddings** : `multilingual-e5-large` local, préfixes `query:`/`passage:`, normalisés cosine.
- **Vector store** (`app/rag/vectorstore.py`) : ChromaDB `PersistentClient`, collection
  **`corpus_fiscal_fr`** (nom technique conservé), espace **cosine** (HNSW).
- **Retriever** (`app/rag/retriever.py`) : embed requête → `query` → **score combiné** similarité ×
  **poids d'autorité** de la source, filtre `concerne` (`influenceur` / `freelance` / `tous`),
  drapeau **fraîcheur** (`freshness_max_days = 120`).

### 7.2 Workflow de réponse RAG (agent pédagogique)

1. `retriever.search(question, k=8, concerne)` → hits triés par autorité+similarité.
2. Si **corpus vide** → message d'amorçage (lancer `scripts/seed_corpus.py`).
3. Si **meilleure similarité < 0.80** → **repli BOFiP en direct** : prétraitement en mots-clés
   (retrait des mots vides) puis `mcp.call_tool("bofip", "bofip_search")`, un seul meilleur extrait
   ajouté au contexte (évite le bruit par polysémie).
4. Fusion des extraits (8 max), construction du prompt système + contexte (profil et historique
   marqués **« contexte, jamais une source »**).
5. **Position déterministe du régime** injectée (issue de `decide_regime`) : le modèle ne peut pas
   affirmer un régime contraire.
6. `Mistral` (temp 0) rédige, **cite les sources** entre crochets, ou **refuse** (« pas de source
   fiable → impots.gouv.fr / expert-comptable »).
7. Réponse + `sources` (source, titre, url, score, périmé), `avertissement_fraicheur`,
   `bofip_live_utilise`.

### 7.3 Autorité & fraîcheur

| Autorité | Exemple | Poids score |
|---|---|---|
| 1 | Légifrance (loi/décret, JORF) | 1.0 |
| 2 | BOFiP, BOSS, URSSAF, DGFiP (doctrine officielle) | 0.9 |
| 3 | guides, sources privées | 0.75 |

Chaque chunk porte `date_verification`; au-delà de `freshness_max_days` (120 j) il est marqué
**périmé** et un avertissement de fraîcheur est ajouté.

---

## 8. Moteur déterministe (régime & roadmap)

- **`data/seuils.yaml`** — **source de vérité unique**. Chaque valeur porte `valeur`, `annee`,
  `source` (URL officielle), `date_verif`. Contient : plafonds micro (BNC / BIC services / BIC
  vente / mixte), règle de **franchissement** (2 années consécutives), **prorata temporis**,
  **franchise TVA** (base / majoré), **micro-social**, **versement libératoire**, compte bancaire.
- **`decide_regime(profil)`** (aucun réseau) → `parcours` ∈ {`micro`, `societe`, `bascule`} +
  **`durabilite`** ∈ {`eligible_stable`, `depassement_ponctuel`, `depassement_durable`,
  `indetermine`}. Activité **mixte** : compare la **part prestations** au seuil services **et** le
  **CA global** au seuil global (jamais le CA total au seuil services) ; `indetermine` si la
  ventilation manque.
- **`build_roadmap(profil)`** → JSON déterministe : `parcours`, `phases` (Préparer / Créer / Faire
  vivre), `etapes` (titre, badge, détail, **lien officiel**, **durée** estimée, **coût sourcé**),
  `seuils_profil` (position vs plafond), **`legal_sources`** (construites depuis `seuils.yaml`),
  `comparatif` (bascule), `mixte`, `prorata`, `meta.fraicheur`.
- Garde-fou `valider_coherence()` : régime, bandeau et étapes appartiennent **toujours au même
  parcours** (impossible d'avoir un bandeau « société » avec des étapes « micro »).

---

## 9. Serveurs MCP — sources de données officielles

Les sources sont exposées comme **outils MCP réutilisables** (transport **stdio** : le client
`app/mcp/client.py` lance chaque serveur en **sous-processus**, chemins **absolus** + `cwd` racine,
env **UTF-8**, propagation des identifiants PISTE). Avantage : sources interchangeables, réutilisables
par d'autres agents, remplaçables sans toucher au cœur.

| Serveur MCP | Outils | Source / API officielle | Auth |
|---|---|---|---|
| **legifrance** | `legifrance_search`, `legifrance_fetch`, `code_article` | **API PISTE** de l'État (`api.piste.gouv.fr`, DILA Légifrance ; JORF/LODA, codes CGI/CCONSO/CSS) | OAuth PISTE (client_id/secret) |
| **bofip** | `bofip_search`, `bofip_fetch` | **Opendatasoft** `data.economie.gouv.fr` dataset `bofip-vigueur` (doctrine fiscale **opposable** en vigueur) | aucune |
| **web-sources** | `list_sources`, `fetch_source`, `check_updates` | Pages **sans API** : URSSAF auto-entrepreneur, DGCCRF influenceurs, ARPP, impots.gouv, service-public — nettoyage BS4 + **diff de hash** | aucune |
| **entreprises** | `rechercher_entreprise`, `inpi_guichet_unique` | `recherche-entreprises.api.gouv.fr` (**Sirene INSEE** + Annuaire) ; lien Guichet unique INPI | aucune |
| **docs-officiels** | `catalogue`, `fetch_page`, `fetch_pdf`, `boss_fetch`, `sp_search` | **API DILA** Service-Public, impots.gouv, **BOSS** (doctrine sociale), PDF (notices) via `pdfminer`, actualités DGFiP/LF | aucune |

**Comment ils fonctionnent** : chaque serveur est un `FastMCP` autonome exposant des `@mcp.tool()`.
Les fetch HTML utilisent un **User-Agent navigateur** (contourne les filtres anti-bot 403) puis
nettoient le contenu (BeautifulSoup/lxml : suppression `script/style/nav/footer/header`, extraction
du `main`). `check_updates` mémorise un **hash** par page (`data/mcp_web_state.json`) pour ne
remonter que les nouveautés.

---

## 10. Enrichissement du corpus & veille

- **Amorçage** : `scripts/seed_corpus.py` (sources `data/sources.yaml`), enrichissement ciblé
  `scripts/enrich_corpus.py` (BOFiP par identifiant, ex. `BOI-BNC-CHAMP-10-10-20-40` pour les
  avantages en nature ; BOSS ; docs-officiels ; 2042-C-PRO).
- **Veille** (`app/veille/scheduler.py`, APScheduler quotidien) :
  1. **collecte** via MCP (Légifrance récents, BOFiP, web-sources `check_updates`, actualités DGFiP
     / loi de finances / BOSS) ;
  2. **résumé + classement** par Mistral (`json_mode` : `resume`, `concerne`, `impact`,
     `pertinent`) ;
  3. **ré-ingestion** dans ChromaDB → corpus vivant ;
  4. **contrôle des seuils** : `verifier_seuils()` compare chaque valeur de `seuils.yaml` à sa
     source officielle (via MCP) et **signale tout écart** (log + rapport) **sans écraser** le
     fichier sourcé/commenté.

---

## 11. Mémoire & persistance (SQLite)

`app/memory/store.py` — `data/ledgermind_v2.sqlite3` (aucune dépendance) :

| Table | Colonnes clés | Rôle |
|---|---|---|
| `sessions` | `id, uid, type(guidance\|pedagogue), title, created_at, updated_at` | conversations, titre auto (1ers mots du 1er message, sans LLM) |
| `messages` | `id, session_id, role, content, sources_json, created_at` | historique + sources |
| `profil` | clé **`uid`** ; `activite, ca_estime, ca_prestations, ca_vente, remuneration_nature, vend_produits, recoit_cadeaux, situation_actuelle, deja_immatricule, devise, choix_parcours…` | profil **PARTAGÉ** entre interfaces + normalisation déterministe (CA total = prestations + ventes) |
| `roadmap` | `session_id, roadmap_json, checked_json` | roadmap + **cases cochées persistées** (retrouvées à la réouverture) |

Purge des sessions inactives (> 30 jours).

---

## 12. Garde-fous anti-hallucination (récapitulatif)

- **RAG-first** + **citations obligatoires** + **refus honnête** sans source fiable.
- **Repli BOFiP en direct** quand le corpus local est faible.
- **Tri par autorité** de source + **avertissement de fraîcheur**.
- **Mémoire jamais une source** (interdiction de « comme je te l'ai dit » sans re-sourcer).
- **Régime/seuils déterministes** : le LLM ne décide jamais d'un régime ni d'un calcul ; sa
  position ne peut pas contredire `decide_regime`.
- **Roadmap jamais générée sur profil incomplet** (gating) ; **accompagnement validé** côté code.
- **Aucune devise convertie en silence** ; **aucun coût/seuil/URL inventé** (tout sourcé dans
  `seuils.yaml` ou le corpus).

---

## 13. Démarrage rapide

```bash
py -3.11 -m venv .venv && .venv\Scripts\activate      # Python 3.11 (pydantic-core)
pip install -r requirements.txt
copy .env.example .env                                # renseigner MISTRAL_API_KEY (+ PISTE_* option)
set PYTHONUTF8=1
python -m scripts.seed_corpus                         # amorce le corpus RAG
python -m scripts.enrich_corpus                       # enrichissement ciblé (MCP)
uvicorn app.main:app --port 8000                      # backend
# Front : cd frontend && python -m http.server 5500  → http://localhost:5500
```

Variables clés (`app/config.py`) : `MISTRAL_MODEL`, `EMBEDDINGS_PROVIDER` (local|mistral),
`LOCAL_EMBEDDING_MODEL`, `CHROMA_DIR`, `CHROMA_COLLECTION`, `PISTE_CLIENT_ID/SECRET`,
`FRESHNESS_MAX_DAYS`, `VEILLE_ENABLED`.
