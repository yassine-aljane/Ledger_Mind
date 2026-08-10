# LedgerMind Assistant

Assistant fiscal pour les **créateurs et indépendants français** : comprendre son statut, produire
ses justificatifs, préparer ses déclarations — sans jamais rien transmettre à l'administration à
la place de l'utilisateur.

Le produit couvre la chaîne complète, de la première question (« dois-je m'immatriculer ? ») à la
préparation des cinq obligations déclaratives du régime micro, en passant par la facturation, la
lecture des pièces reçues et le calcul de l'impôt.

> **Ce README est la carte du dépôt** : comment le système fonctionne de bout en bout, où vit
> chaque morceau de code, et quelles règles respecter pour ajouter une fonctionnalité sans casser
> la promesse du produit.

---

## Sommaire

1. [Le produit en cinq minutes](#1-le-produit-en-cinq-minutes)
2. [Les six règles qui commandent tout le code](#2-les-six-règles-qui-commandent-tout-le-code)
3. [Architecture d'ensemble](#3-architecture-densemble)
4. [Arborescence du dépôt](#4-arborescence-du-dépôt)
5. [Installation et premier démarrage](#5-installation-et-premier-démarrage)
6. [Les parcours utilisateur, écran par écran](#6-les-parcours-utilisateur-écran-par-écran)
7. [Les agents backend, un par un](#7-les-agents-backend-un-par-un)
8. [Le moteur de calcul fiscal](#8-le-moteur-de-calcul-fiscal)
9. [Référence API](#9-référence-api)
10. [Données : MongoDB et `data/*.yaml`](#10-données--mongodb-et-datayaml)
11. [LLM contre déterministe](#11-llm-contre-déterministe)
12. [Frontend](#12-frontend)
13. [Tests](#13-tests)
14. [Ajouter une fonctionnalité](#14-ajouter-une-fonctionnalité)
15. [Conventions et pièges](#15-conventions-et-pièges)
16. [Intégrations externes](#16-intégrations-externes)
17. [Documents de référence](#17-documents-de-référence)
18. [Aide-mémoire](#18-aide-mémoire)

---

## 1. Le produit en cinq minutes

### Deux portes d'entrée

Tout commence par une seule question : **avez-vous déjà un SIREN ?**

| Réponse | Branche | Ce qui se passe |
|---|---|---|
| « Oui » | **A · intake** | Vérification de l'identité dans les registres publics (SIRENE / RNE), dépôt éventuel du Kbis ou de l'avis de situation, puis questions de profil → catégorie fiscale, alertes de conformité |
| « Non » ou « je ne sais pas » | **B · guidance** | Diagnostic **conversationnel** (l'utilisateur décrit son activité, le profil se construit tout seul) → **feuille de route** déterministe de régularisation |

Les deux branches alimentent le même compte. Une fois le parcours terminé, l'utilisateur accède
aux outils : facturation, lecture de pièces, rapport fiscal, déclarations, scénarios.

### Free contre Premium

La règle de fond, tenue par `frontend/src/lib/entitlements.ts` : **le gratuit sert à COMPRENDRE,
le Premium à AGIR.**

| État d'accès | Qui | Ce qui est ouvert |
|---|---|---|
| `invite` | non connecté | Landing publique + Assistant fiscal (`/education`) |
| `free` | connecté, sans Premium | idem |
| `premium_parcours` | Premium, mise en route inachevée | Mise en route + feuille de route |
| `premium_complet` | Premium, mise en route terminée | Tous les outils |

> La bascule Premium est **une démo côté client** (`frontend/src/lib/plan.ts`, clé
> `lm.plan.<uid>` du `localStorage`). Aucun endpoint de paiement n'existe côté backend.

### Les espaces du produit

| Espace | Route | Ce qu'on y fait |
|---|---|---|
| Assistant fiscal | `/education` | Question fiscale libre, réponse sourcée (BOFiP, Légifrance, URSSAF) |
| Ma situation | `/dashboard`, `/rapport` | Tableau de bord chiffré + génération du rapport fiscal |
| Mise en route | `/onboarding/*` | Branche A (vérification) ou branche B (diagnostic) |
| Versements | `/capture` | Dépôt de factures reçues, virements, contrats, cadeaux en nature |
| Facturation | `/activite` | Cycle de vie complet d'une facture émise |
| Déclaration | `/declaration` | Brouillons des cinq obligations déclaratives |
| Scénarios | `/simulateur` | Comparaison de variantes fiscales « et si… » |
| Historiques | `/historique` | Flux unifié de toutes les pièces, avec anomalies et justificatifs manquants |
| Expert-comptable | `/referral` | Recherche de cabinets + brouillons d'e-mails de prise de contact |
| Centre d'Actions | panneau global | Agenda fiscal (échéances) + veille réglementaire personnalisée |

---

## 2. Les six règles qui commandent tout le code

Ces règles ne sont pas des préférences de style : chacune évite une classe de bug qui produirait
un chiffre faux **sans que rien ne le signale**.

### 1. Aucun montant fiscal n'est calculé deux fois

Un seul module calcule de l'argent : **`backend/app/agents/impots`**. Le rapport fiscal, les
déclarations et les scénarios l'appellent — ils ne recalculent jamais. Deux implémentations de la
même formule finiraient par diverger.

### 2. Aucun seuil, taux ou mention légale codé en dur

Toute valeur réglementaire vit dans `data/*.yaml`, avec sa `source` (URL officielle) et sa
`date_verif`. Le code ne fait que lire. Une valeur absente lève une exception plutôt que de
retomber sur un défaut silencieux.

### 3. Ce qui n'est pas calculable reste `None`

Un champ non calculé s'affiche « non calculable », **jamais « 0 € »**. Sans contexte de foyer,
l'IR au barème n'est pas estimé : un zéro se lit « vous ne paierez rien », ce qui est faux et
coûteux.

### 4. Rien n'est transmis à l'administration

Il n'existe **aucun endpoint de transmission**, et un test le vérifie. Les documents produits sont
des aides à la préparation : l'utilisateur relit, valide, et va lui-même sur le portail officiel.
Les boutons « Payer » / « Déclarer » ouvrent le vrai site (`autoentrepreneur.urssaf.fr`,
`impots.gouv.fr`, `PayFiP`, `portailpro.gouv.fr`, `douane.gouv.fr`) dans un nouvel onglet. Aucune
donnée bancaire ne transite par LedgerMind.

### 5. L'humain fait autorité sur la machine

Une estimation automatique n'est jamais une déclaration. La valeur d'un cadeau reçu, par exemple,
exige une confirmation explicite (`valeur_confirmee`) avant d'entrer en comptabilité, et
l'arbitrage humain est tracé (`valeur_corrigee`). Toute correction manuelle écrase l'extraction
automatique.

### 6. Chaque chiffre porte sa provenance

Une ligne de déclaration sait de quelles factures elle vient. Un rattachement incertain est
marqué `a_verifier` plutôt que présenté comme sûr. Le LLM ne conclut jamais en droit : il
reformule, extrait, ou accompagne.

---

## 3. Architecture d'ensemble

```text
┌──────────────────────────────┐        HTTP JSON        ┌──────────────────────────────────────┐
│  Frontend                    │  ←──────────────────→   │  Backend — FastAPI                   │
│  TanStack Start · React 19   │  :3000  ↔  :8000        │                                      │
│  Tailwind 4 · shadcn/ui      │                         │  api/       16 routeurs              │
│                              │                         │  agents/    14 agents                │
│  Landing publique            │                         │    ├─ orchestrator (machine à états) │
│  Mise en route (A / B)       │                         │    ├─ intake · guidance · pedagogue  │
│  Outils Premium              │                         │    ├─ capture (LangGraph)            │
│  Centre d'Actions            │                         │    ├─ facture · impots               │
└──────────────────────────────┘                         │    ├─ rapport_fiscal · declarations  │
                                                         │    ├─ echeancier · referral          │
                                                         │    └─ …                              │
                                                         │  rag/  veille/  mcp/  product_rag/   │
                                                         └──────────────────────────────────────┘
                                                                │            │            │
                                     ┌──────────────────────────┘            │            └────────────┐
                                     ▼                                       ▼                         ▼
                              MongoDB                                Mistral · Gemini            Pinecone
                     ledgermind + ledgermind_checkpoints            (LLM + embeddings)      (corpus produit)
                                                                                                   │
                                                                     ┌─────────────────────────────┘
                                                                     ▼
                                                     Sources officielles via MCP
                                        (Légifrance/PISTE · BOFiP · INSEE · docs officiels · web)
```

### Deux fournisseurs LLM, par domaine

Les quotas sont **séparés** : l'épuisement de l'un n'éteint pas l'autre.

| Fournisseur | Utilisé par | Code |
|---|---|---|
| **Mistral** | guidance, pédagogue, veille, appréciation de rapport, interprétation de scénarios, assistant produit, **embeddings du corpus**, OCR de l'agent capture | `app/llm/mistral.py`, `app/agents/capture/app/mistral_client.py` |
| **Gemini** | agent `intake` (branche A : formulation des questions et compréhension des réponses), repli d'extraction du profil guidance, classification d'un document de registre ambigu | `app/llm/gemini.py` |

`app/llm/__init__.py` exporte `chat_text` / `chat_json_with_system` (Mistral) et `chat_json`
(Gemini) : les agents ignorent le fournisseur.

### Deux corpus RAG, jamais mélangés

| Corpus | Contenu | Stockage | Sert |
|---|---|---|---|
| **Fiscal** | BOFiP, Légifrance, URSSAF, impots.gouv | MongoDB `corpus_chunks`, similarité cosinus en Python | Assistant fiscal (`pedagogue`), mentions de facture, sources des rapports |
| **Produit** | `DOCUMENTATION_RAG_LEDGERMIND.md` | Pinecone, namespace `product-docs` | Chatbot public de la landing page |

La séparation est délibérée : une question sur le prix ne doit jamais remonter un article BOFiP,
et une question fiscale ne doit jamais prendre une page marketing pour source juridique.

---

## 4. Arborescence du dépôt

```text
ledgermind-assistant/
├── README.md                          ← ce fichier
├── DECLARATIONS-AGENT.md              ← agent déclaratif : ce qu'il décide, ce qu'il refuse
├── RAPPORT-FISCAL-HYPOTHESES.md       ← rapport fiscal : hypothèses et valeurs à recouper
├── DOCUMENTATION_RAG_LEDGERMIND.md    ← corpus du chatbot produit (indexé dans Pinecone)
├── NOTE-CALCULS-FISCAUX.pdf           ← note générée DEPUIS le moteur (scripts/generer_doc_calculs)
├── requirements.txt                   ← dépendances Python (installer depuis la racine)
├── pytest.ini                         ← pythonpath=backend, asyncio_mode=auto
│
├── backend/
│   ├── .env.example
│   ├── app/
│   │   ├── main.py                    ← app FastAPI, CORS, planificateur de veille
│   │   ├── config.py                  ← settings (pydantic-settings), lit backend/.env
│   │   ├── api/                       ← 16 routeurs HTTP, aucune logique métier
│   │   ├── agents/
│   │   │   ├── orchestrator.py        ← machine à états des branches A et B
│   │   │   ├── intake/                ← branche A : vérification + questions de profil
│   │   │   ├── guidance/              ← branche B : chat, profil, feuille de route
│   │   │   │   └── roadmap/           ← moteur juridique déterministe
│   │   │   ├── pedagogue/             ← Q&R fiscale sourcée (RAG)
│   │   │   ├── capture/               ← LangGraph : lecture des pièces reçues
│   │   │   ├── facture/               ← émission : brouillon → émise → avoir → réglée
│   │   │   ├── impots/                ← LE moteur de calcul (abattements, IR, cotisations)
│   │   │   ├── rapport_fiscal/        ← rapport sur CA ENCAISSÉ (rapprochement bancaire)
│   │   │   ├── declarations/          ← les cinq obligations, brouillons jamais transmis
│   │   │   ├── echeancier/            ← agenda fiscal (règles + décision + calendrier)
│   │   │   ├── referral/              ← recherche de cabinets + e-mails de contact
│   │   │   ├── expert_comptable/      ← recherche en sources officielles/ouvertes
│   │   │   ├── rapport/               ← rapport d'activité (CA facturé) — chantier antérieur
│   │   │   └── declaration/           ← 2042-C-PRO sur CA facturé — chantier antérieur
│   │   ├── rag/                       ← corpus fiscal : embeddings, vectorstore, retriever
│   │   ├── product_rag/               ← corpus produit : Pinecone, agent public
│   │   ├── veille/                    ← veille réglementaire personnalisée + planificateur
│   │   ├── mcp/                       ← client MCP (sources officielles)
│   │   ├── llm/                       ← clients Mistral et Gemini
│   │   ├── schemas/                   ← modèles Pydantic partagés (API + état de session)
│   │   ├── services/                  ← recherche-entreprises, INSEE, INPI, OCR
│   │   └── core/                      ← Mongo, users, sessions, mémoire conversationnelle, JWT
│   ├── mcp_servers/                   ← serveurs MCP : Légifrance/PISTE, BOFiP, INSEE, docs, web
│   ├── scripts/                       ← amorçage de corpus, backfills, générateurs de documents
│   └── tests/                         ← 39 fichiers, 741 tests
│
├── data/                              ← données PRODUIT, revues à la main — pas du code
│   ├── seuils.yaml                    ← plafonds micro, cotisations, franchise TVA, VL
│   ├── impot_revenu.yaml              ← barème IR, quotient familial, décote, CFP, ACRE
│   ├── declarations.yaml              ← cases officielles, TFCC, CFE, DES
│   ├── facturation.yaml               ← mentions obligatoires, délais, numérotation
│   ├── sources.yaml                   ← registre des sources du corpus RAG (avec autorité)
│   └── regimes/micro.yaml             ← règles d'obligations du moteur d'échéances
│
├── frontend/
│   ├── package.json
│   └── src/
│       ├── routes/                    ← routage par fichiers (TanStack Router)
│       ├── components/lm/             ← composants métier LedgerMind
│       ├── components/ui/             ← shadcn/ui (Radix + Tailwind)
│       └── lib/                       ← clients API, droits d'accès, calculs d'affichage
│
├── docs/
│   ├── ARCHITECTURE-BASE-DE-DONNEES.md      ← toutes les collections, index et pièges
│   ├── FACTURATION-VALEURS-REGLEMENTAIRES.md ← valeurs à vérifier en direct
│   ├── veille-personnalisee.md               ← ce que la veille garantit, et ce qu'elle ne garantit pas
│   ├── AGENT2-INSIGHTS.md
│   └── Guide_LedgerMind_Rapport_Fiscal.pdf
│
├── CONTRIBUTING.md                    ← branches, conflits, fichiers partagés
└── .github/CODEOWNERS                 ← qui relit quoi
```

---

## 5. Installation et premier démarrage

### Prérequis

- **Python 3.11+** (3.12 en développement)
- **Node.js 20+**
- **MongoDB** accessible en local (ou une URI joignable)
- Une clé **Mistral** — [console.mistral.ai](https://console.mistral.ai) — guidance, pédagogue,
  veille, capture, embeddings
- Une clé **Gemini** — [Google AI Studio](https://aistudio.google.com/apikey) — branche intake et OCR
- *Facultatif* : une clé **Pinecone** (chatbot produit de la landing page) et des clés **PISTE**
  (Légifrance dans la veille)

### Backend

```bash
# depuis la racine du dépôt
python -m venv .venv

# Windows
.\.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt

copy backend\.env.example backend\.env    # Windows
# cp backend/.env.example backend/.env    # macOS / Linux

# renseigner au minimum GEMINI_API_KEY, MISTRAL_API_KEY et MONGO_URI
cd backend
uvicorn app.main:app --reload --port 8000
```

- Santé : [http://localhost:8000/health](http://localhost:8000/health)
- Documentation interactive : [http://localhost:8000/docs](http://localhost:8000/docs)

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Application : [http://localhost:3000](http://localhost:3000)

### Variables d'environnement

Définies dans `backend/.env` (modèle complet et commenté dans `backend/.env.example`).

| Variable | Rôle | Valeur typique |
|---|---|---|
| `GEMINI_API_KEY` | Branche intake + OCR | votre clé |
| `GEMINI_MODEL` | Modèle Gemini — attention au palier gratuit | `gemini-2.5-flash-lite` |
| `MISTRAL_API_KEY` | Guidance, pédagogue, veille, capture, embeddings | votre clé |
| `MISTRAL_MODEL` | Modèle de génération | `mistral-small-latest` |
| `EMBEDDING_MODEL` | Modèle vectoriel du corpus fiscal | `mistral-embed` |
| `MONGO_URI` | Comptes, sessions, pièces, corpus | `mongodb://localhost:27017` |
| `MONGO_DB_NAME` | Nom de la base | `ledgermind` |
| `AUTH_SECRET` | Clé de signature JWT (**≥ 32 caractères**) | à changer en production |
| `AUTH_TOKEN_DAYS` | Durée de vie du jeton | `14` |
| `FRONTEND_ORIGIN` | Liste CORS, séparée par des virgules | `http://localhost:3000` |
| `PINECONE_API_KEY` | Chatbot produit (facultatif) | votre clé |
| `PINECONE_INDEX_NAME` / `_NAMESPACE` | Index et namespace produit | `ledgermind-product` / `product-docs` |
| `PRODUCT_RAG_TOP_K` / `_MIN_SCORE` | Réglage de la recherche produit | `6` / `0.45` |
| `VEILLE_ENABLED` | Cycle de veille quotidien | `true` |
| `VEILLE_CRON_HOUR` | Heure du cycle | `6` |
| `PISTE_CLIENT_ID` / `_SECRET` | Légifrance (facultatif — sans elles, les autres sources restent actives) | — |
| `FRESHNESS_MAX_DAYS` | Âge maximal toléré d'une valeur sourcée | `120` |

Surcharge côté frontend :

| Variable | Rôle | Défaut |
|---|---|---|
| `VITE_API_BASE` | URL de base du backend | `http://localhost:8000` |

> **CORS** — `FRONTEND_ORIGIN` accepte plusieurs origines séparées par des virgules, et
> `main.py` reflète automatiquement `localhost` ↔ `127.0.0.1` ainsi que tout port local
> (Vite peut basculer sur `:3001` ou `:5173`).

### Amorçage : les corpus ne se remplissent pas tout seuls

```bash
# 1. Corpus fiscal (assistant fiscal, mentions sourcées) — MongoDB
python -m backend.scripts.seed_corpus          # télécharge et ingère data/sources.yaml
python -m backend.scripts.enrich_corpus        # complète via MCP (API officielles, pas de scraping)
python -m backend.scripts.enrich_legifrance    # articles de codes via PISTE (autorité 1)

# 2. Corpus produit (chatbot de la landing page) — Pinecone
python -m backend.scripts.index_product_knowledge
```

`index_product_knowledge` lit `DOCUMENTATION_RAG_LEDGERMIND.md`, crée l'index Pinecone si besoin
(dense, cosinus, 1024 dimensions) et **remplace uniquement** le namespace `product-docs`. À
relancer après chaque modification du document. État visible sur
`GET /api/product-assistant/status`.

> **Après tout changement de `EMBEDDING_MODEL`** : lancer
> `python -m backend.scripts.reembed_corpus`. Les vecteurs de deux modèles différents ne sont pas
> comparables — la recherche devient silencieusement inexploitable.

### Autres scripts utiles

| Script | Rôle |
|---|---|
| `backend.scripts.migrate_prototype` | Reprend le prototype (ChromaDB + SQLite) dans MongoDB |
| `backend.scripts.migrer_jeux_declarations` | Sépare les jeux de déclarations des déclarations préparées |
| `backend.scripts.backfill_amount_eur` | Recalcule les contre-valeurs en euros manquantes |
| `backend.scripts.backfill_guidance_agent_context` | Peuple `agent_context.guidance` sur les comptes anciens |
| `backend.scripts.generer_doc_calculs` | Produit `NOTE-CALCULS-FISCAUX.pdf` **depuis le moteur** |
| `backend.scripts.generate_rapport_fiscal_guide` | Produit le guide du rapport fiscal |
| `docs-test/generer.py` | Génère des pièces de test (specimens) pour éprouver `/capture` |

---

## 6. Les parcours utilisateur, écran par écran

### Landing publique — `/`

Page marketing avec vidéo de présentation et **chatbot produit** (`ProductAssistant.tsx`) :
un widget RAG public qui répond aux questions sur LedgerMind lui-même et **redirige** toute
demande de conseil fiscal personnel vers l'Assistant fiscal.

### Authentification — `/auth`

MongoDB + JWT, sans dépendance externe.

- Inscription → `POST /api/auth/register` (utilisateur créé dans la collection `users`)
- Connexion → `POST /api/auth/login`
- Le jeton vit dans `localStorage` (`ledgermind_access_token`) et part en `Authorization: Bearer …`
- Le bouton Google OAuth est désactivé (non implémenté)

### Mise en route — `/onboarding/`

L'utilisateur choisit sa branche.

**Branche A — vérification puis profil**

1. Saisie du SIREN (9 chiffres) ou SIRET (14), ou OCR d'un document
2. `POST /api/orchestrator/start` avec le SIRET
3. Dépôts éventuels : document de registre (Kbis / extrait RNE, souvent pour une EI), puis avis
   de situation SIRENE
4. Questions de profil (`Chatbot` sur `/onboarding/profil`) — y compris les champs que **aucun
   registre ne connaît** : foyer fiscal, caisse de retraite BNC, IBAN, date de début d'activité,
   ACRE. Sans eux, le moteur d'impôt refuse de calculer l'IR plutôt que d'afficher un montant
   inventé.
5. Fin de parcours → les outils se déverrouillent

**Branche B — diagnostic conversationnel puis feuille de route**

Ce n'est pas un questionnaire : l'utilisateur décrit son activité avec ses mots, et le profil se
construit depuis la conversation.

1. `/onboarding/diagnostic` affiche `GuidanceChat` — aucun appel serveur pour démarrer
2. Chaque message → `POST /api/guidance/chat` (la session naît au premier message)
3. Le backend décide de ce qui manque encore. **La feuille de route n'est jamais produite tant
   qu'un fait légalement requis est absent.** Quand le profil est complet, la réponse porte
   `roadmap`.
4. « Voir ma feuille de route » → `/onboarding/diagnostic/resultat`, avec export PDF
5. « J'ai déjà mon SIREN » bascule vers `/onboarding/verification`

Trois pièces d'interface pilotées par l'utilisateur (`frontend/src/components/lm/`) :

| Composant | Rôle |
|---|---|
| `GuidanceChat.tsx` | chat, suggestions d'ouverture, options cliquables décidées par le backend |
| `StatusCard.tsx` | **fiche de statut adaptative** — les cartes apparaissent à mesure que les faits sont détectés, chacune modifiable ou supprimable |
| `ConversationHistory.tsx` | historique : réouvrir, renommer, supprimer une conversation |
| `SuggestionChips.tsx` | **profilage rapide** : répondre sans jamais taper |

Rien de fiscal n'est codé dans le frontend : questions, réponses rapides, options et feuille de
route viennent toutes du backend déterministe.

> **Note de routage :** `resultat` est une route **enfant** de `diagnostic`. Le parent doit rendre
> `<Outlet />`, sinon la page reste blanche.

**Accès anonyme** — sans jeton, l'identité vient de l'en-tête `X-Anon-Id` (un UUID généré et gardé
dans le `localStorage`, voir `frontend/src/lib/anon.ts`). Chaque visiteur anonyme a son propre
profil isolé, purgé après 30 jours d'inactivité ; sans en-tête, une identité jetable est créée
pour la requête — jamais une identité partagée.

### Assistant fiscal — `/education`

Ouvert à tous, même sans compte. Question fiscale libre, réponse en français simple, **ancrée sur
des sources citées** (BOFiP, Légifrance, URSSAF). Fonctionne aussi en mode conversation via
`POST /api/guidance/chat` avec `mode: "pedagogue"`, ce qui conserve l'historique.

### Ma situation — `/dashboard` et `/rapport`

Tableau de bord chiffré : encaissements, position par rapport aux plafonds, prélèvements estimés,
visualisations (`FiscalVisualisations.tsx`, `charts.tsx`, `FiscalReceipt.tsx`). Le bouton
« générer un rapport » mène à `/rapport`, page dédiée : un rapport ne se produit pas à la suite
d'une facture, il se produit quand on veut faire le point.

### Versements — `/capture`

Dépôt d'une pièce (PDF ou image, jusqu'à 20 Mo). L'agent la lit, la classe, la résume et la
range. Quatre natures reconnues :

| Nature | Ce qui en est fait |
|---|---|
| **Facture reçue** | dépense, catégorie, échéance, TVA déductible |
| **Virement** | encaissement — c'est la base du rapprochement bancaire |
| **Contrat** | cohérence (prestation exécutée non facturée ?) — **n'entre jamais dans l'assiette** |
| **Cadeau en nature** | avantage en nature → **revenu imposable**, à sa valeur marchande |

Tout le reste sort en « hors périmètre », sans être enregistré. L'agent **pose une question**
quand un champ obligatoire manque (`DocumentChatDrawer.tsx`), la pièce d'origine reste
consultable (`DocumentInspector.tsx`), et toute correction humaine écrase l'extraction
automatique.

Le parcours cadeau est volontairement en deux temps (`GiftCadeauDrop.tsx`,
`CadeauDeclaration.tsx`) : `POST /api/capture/cadeau/estimer` propose une valeur **sans rien
enregistrer**, `POST /api/capture/cadeau` enregistre et exige `valeur_confirmee`. **Estimer
n'engage rien ; déclarer engage.**

### Facturation — `/activite`

Premium + SIREN vérifié. Cycle de vie complet (`FactureCycleVie.tsx`) :

```text
brouillon ──emettre──► émise ──reglement──► réglée
    │                    │
 supprimable         avoir ──► annulée (archivée, séquence intacte)
```

- Un **brouillon** ne consomme aucun numéro : une création abandonnée ne laisse pas de trou dans
  la séquence, ce que la réglementation interdit.
- L'**émission** attribue le numéro, fige et date le document — c'est ce jalon, et lui seul, qui
  donne au document son existence fiscale.
- Une facture émise est **immuable**. La correction conforme est l'**avoir**.
- Supprimer une facture émise exige `confirmer_suppression_emise=true` et le numéro retiré est
  consigné (`GET /api/facture/suppressions`) pour rester justifiable lors d'un contrôle.
- Les mentions obligatoires viennent mot pour mot de `data/facturation.yaml`. Une mention absente
  lève `MentionManquante` plutôt qu'une facture au texte inventé.
- Un template uploadé n'est **jamais bloquant** : toute erreur d'analyse retombe sur le modèle
  standard.

### Déclaration — `/declaration`

Les **cinq obligations** du régime micro, en brouillons prêts à recopier. Déclarer ne prolonge pas
la facturation : c'est une obligation à échéance fixe, qui vaut même sans facture émise sur la
période — d'où une page atteinte directement depuis le rail.

Détail complet dans [DECLARATIONS-AGENT.md](DECLARATIONS-AGENT.md).

### Scénarios — `/simulateur`

Comparaison de variantes fiscales « et si… » : CA différent, changement de catégorie, versement
libératoire ou barème, passage d'un plafond. Le contexte est prérempli depuis le profil et les
factures réelles ; l'utilisateur peut aussi décrire son scénario en langage naturel
(`POST /api/simulation/interpreter`, la seule intervention LLM de l'écran — elle **interprète**,
elle ne calcule pas).

### Historiques — `/historique`

Flux unifié de toutes les pièces (factures émises, factures reçues, virements, contrats, cadeaux),
filtrable, avec agrégation des anomalies et décompte des pièces sans justificatif.

### Expert-comptable — `/referral`

Recherche de cabinets autour d'une ville (OpenStreetMap / Overpass + géocodage + API entreprises),
affichés sur une carte Leaflet, avec des **brouillons d'e-mails** de prise de contact
personnalisés depuis le profil fiscal. Aucun e-mail n'est envoyé automatiquement.

`GET /api/expert-comptable?ville=…` est la voie plus stricte, déclenchée depuis la déclaration
(« faire vérifier / signer ») : sources officielles et ouvertes uniquement, jamais de cabinet
inventé, et le lien vers l'annuaire officiel de l'Ordre est toujours présent.

### Centre d'Actions — panneau global

Ouvert depuis `AppShell` sur toutes les pages produit (`CentreActions.tsx`). Deux contenus :

**Agenda fiscal** (`/api/echeancier/*`) — les obligations applicables, leur date ou fenêtre, leur
statut. Les paramètres de calendrier manquants (périodicité URSSAF, régime de TVA, clients UE)
sont demandés **une seule fois, en ligne dans l'agenda** — jamais insérés dans la séquence
d'onboarding. Le statut « régularisée » ne s'obtient que par une confirmation déclarative de
l'utilisateur : LedgerMind ne déduit jamais qu'un paiement a eu lieu.

**Veille réglementaire** (`/api/veille/*`) — les nouveautés fiscales qui concernent ce profil,
la plus contraignante d'abord. Aucun SIREN n'est exigé : un utilisateur de la branche B est
justement celui qui a le plus besoin de savoir qu'une règle change.

### Compte et formule — `/parametres`, `/premium`

Profil, thème clair/sombre, contexte des deux agents. `/premium` présente les deux formules et
bascule le plan (démo côté client).

---

## 7. Les agents backend, un par un

| Agent | Dossier | Ce qu'il produit | LLM ? |
|---|---|---|---|
| **orchestrator** | `agents/orchestrator.py` | Aiguillage des phases, persistance de session | non |
| **intake** | `agents/intake/` | Identité vérifiée, catégorie fiscale, alertes | Gemini (formulation, compréhension) |
| **guidance** | `agents/guidance/` | Profil de diagnostic + feuille de route | Mistral (conversation, accompagnement) |
| **pedagogue** | `agents/pedagogue/` | Réponse fiscale sourcée | Mistral (rédaction sur extraits cités) |
| **capture** | `agents/capture/` | Pièces lues, classées, dédupliquées | Mistral (OCR, extraction, synthèse) |
| **facture** | `agents/facture/` | Factures émises conformes + PDF | non |
| **impots** | `agents/impots/` | **Tous les montants fiscaux** | **jamais** |
| **rapport_fiscal** | `agents/rapport_fiscal/` | Rapport sur CA encaissé + PDF | non (le calcul vient d'`impots`) |
| **declarations** | `agents/declarations/` | Les cinq brouillons déclaratifs + PDF | non |
| **echeancier** | `agents/echeancier/` | Agenda des obligations | non |
| **veille** | `app/veille/` | Catalogue de nouveautés + notifications | Mistral (qualification, **une seule fois**) |
| **referral** | `agents/referral/` | Cabinets + e-mails de contact | Mistral (rédaction des e-mails) |
| **expert_comptable** | `agents/expert_comptable/` | Cabinets en sources officielles | non |
| **product_rag** | `app/product_rag/` | Réponses sur le produit | Mistral (sur extraits Pinecone) |

### Orchestrateur — `agents/orchestrator.py`

Machine à états **déterministe** et mince. À chaque tour :

1. Charger la session depuis MongoDB par `session_id`
2. Aiguiller sur `state.phase`
3. Appeler l'agent compétent
4. Sauvegarder la session
5. Renvoyer `OrchestratorTurnResponse` (`ui_action`, `message`, `quick_replies`, `profile`, et
   éventuellement `roadmap` / `diagnostic_profile`)

```text
Branche A                                    Branche B
─────────────────────────────────            ──────────────────────────
verification                                 diagnostic_questions
  → verification_registry_document             → diagnostic_roadmap
  → verification_document                      → done
  → profile_questions
  → done
```

`tax_classification` et `compliance_check` figurent encore dans le schéma pour compatibilité : la
classification tourne désormais pendant la finalisation de l'intake.

Valeurs de `ui_action` consommées par le frontend :

| `ui_action` | Signification |
|---|---|
| `ask_question` | Afficher la question + les réponses rapides |
| `upload_registry_document` | Demander le Kbis / extrait RNE |
| `upload_sirene_document` | Demander l'avis de situation SIRENE |
| `show_verification_result` | Résultat de la vérification registre |
| `show_roadmap` | Diagnostic terminé — afficher le CTA |
| `show_tax_result` / `show_compliance` / `done` | Intake terminé |
| `requires_expert` | Orientation humaine / SIE |

### Intake — branche A — `agents/intake/`

| Fichier | Rôle |
|---|---|
| `agent.py` | Application de la vérification, question suivante, traitement des réponses, finalisation |
| `questions.py` | Ordre des champs + formulation par LLM (avec repli statique) |
| `understand.py` | Texte libre → champs de `UserProfile` |
| `tools/verification.py` | Recherche SIRENE / RNE (**sans LLM**) |
| `tools/registry_analysis.py` | Interprétation d'un document de registre |
| `tools/extract_answer.py` | Extraction déterministe de champs |
| `tools/classify_tax.py` | Heuristiques BIC / BNC / mixte |
| `tools/check_compliance.py` | Alertes et incohérences |

### Guidance — branche B — `agents/guidance/`

| Fichier | Rôle |
|---|---|
| `conversation.py` | Le tour de conversation : quoi demander, quelles chips proposer |
| `chat.py` | Mémoire, titres, aiguillage guidance / pédagogue |
| `questions.py` | Banque de questions **statique** + `next_missing_field` + `to_roadmap_profil` |
| `understand.py` | Extraction dans `DiagnosticProfile` (limitée au `target_field` ; réponses rapides, regex, puis repli Gemini) |
| `accompaniment.py` | Court texte d'accompagnement de la feuille de route (rejeté s'il est trop pauvre) |
| `roadmap/` | **Moteur juridique et UX déterministe** |

```text
DiagnosticProfile
  → to_roadmap_profil()
  → analyse_juridique / comparateur / presentation
  → roadmap_builder.build_roadmap()
  → dict (bandeau, etapes, phases, …)
```

Les seuils ne vivent **pas** ici : ils sont dans `data/seuils.yaml`, lus via `roadmap/seuils.py`.

**Profilage rapide (chips + « Autre »)** — `suggestions_champ` est la structure que le frontend
rend en boutons cliquables plutôt qu'en question ouverte :

- **Champs fermés** (`vend_produits`, `devise`) — suggestions issues de la table déterministe de
  `conversation.py`, aucun appel LLM, `ouvert: false`
- **`ventilation`** — simple partage arithmétique du `ca_estime` déjà connu, donc déterministe
- **Champs ouverts** (`ca_estime`) — défauts déterministes d'abord, puis
  `POST /suggestions/affiner` peut les remplacer par des libellés affinés en arrière-plan : les
  chips ne sont **jamais** bloquées par cet appel
- Cliquer une chip envoie `action: {kind: "reponse_champ", champ, valeurs}`, appliqué
  **directement** au profil (`store.patch_profil`), en contournant l'extraction sémantique — le
  texte libre, lui, passe toujours par `extraire_profil`

### Capture — `agents/capture/`

Graphe **LangGraph** avec point de reprise MongoDB, ce qui permet à une analyse interrompue de
survivre entre deux requêtes HTTP : `/analyze` démarre un thread, `/answer` le reprend.

```text
ocr → detect_language → (translate_to_fr?) → detect_document_type
   ├── facture  : extract_fields → (ask_missing_field ⟲) → write_analysis
   │              → classify_expense → check_duplicate → save_to_db
   ├── virement : extract_virement → (ask_missing ⟲) → analyze → check_duplicate → save
   ├── contrat  : extract_contrat  → (ask_missing ⟲) → analyze → check_duplicate → save
   └── autre    : reject_unsupported  (rien n'est enregistré)
```

Points remarquables :

- **Human-in-the-loop** par `interrupt` LangGraph : un champ obligatoire manquant suspend le
  graphe et pose la question.
- **Déduplication par index unique MongoDB**, avec les champs de la clé recopiés à la racine du
  document (« miroirs »). Toute correction doit mettre à jour **les deux** — voir
  `update_document_fields`.
- **Multilingue et manuscrit** : la langue est détectée, le texte traduit si besoin, et les champs
  lus avec incertitude sont marqués (`uncertain_fields`).
- **Devises** : conversion en euros via un cache `fx_rates` (BCE, puis source élargie), la
  provenance du taux suivant toujours le chiffre.
- **Cadeaux en nature** : `estimer` (aucune écriture) puis `cadeau` (écriture, `valeur_confirmee`
  exigée).

### Rapport fiscal — `agents/rapport_fiscal/`

> **L'assiette imposable est le chiffre d'affaires ENCAISSÉ, jamais le facturé.**

Toute l'architecture découle de là : l'agent **rapproche** les factures émises des virements reçus
au lieu de sommer les factures.

| Stratégie de rapprochement | Fiabilité |
|---|---|
| Numéro de facture trouvé dans le motif ou la référence | **certain** |
| Montant concordant (tolérance 0,02 €) dans une fenêtre de 120 jours, avec **un seul** candidat | **à confirmer** — compté mais isolé, avec alerte |

Le rapport expose **le chemin du calcul** : catégorie fiscale, abattement, base, cotisations, CFP,
IR, comparaison barème / versement libératoire, contrôle du plafond, prorata de première année,
position vis-à-vis de la franchise de TVA, ACRE, et les paramètres appliqués avec leur source.
Le CA facturé y figure comme **indicateur d'écart**, jamais comme second résultat.

Détail complet et limites connues dans
[RAPPORT-FISCAL-HYPOTHESES.md](RAPPORT-FISCAL-HYPOTHESES.md).

### Déclarations — `agents/declarations/`

Les cinq obligations, chacune avec son déclencheur :

| # | Déclaration | Formulaire | Déclenchée par |
|---|---|---|---|
| 1 | Chiffre d'affaires URSSAF | téléservice | **toujours**, même à 0 € |
| 2 | Revenus annuels | 2042-C-PRO (CERFA 11222) | toujours, une fois par an |
| 3 | DES | téléservice Prodouane | un encaissement venant d'une entité établie dans l'UE — **même sous franchise de TVA** |
| 4 | TVA | 3310-CA3 | régime `reel_simplifie` ou `reel_normal` uniquement |
| 5 | CFE | 1447-C-SD | dès la 2ᵉ année (exonération d'office la première) |

Quatre interdits, tous tenus par des tests :

1. **Ne jamais déduire l'abattement** avant de remplir une case — les cases attendent le CA
   **brut**, l'administration applique l'abattement ; le déduire ici le compterait deux fois.
2. **Ne jamais inventer un numéro de case** — les références du CA3 ne sont pas recoupées : ces
   champs sortent marqués `a_verifier`, sans numéro.
3. **Ne jamais fusionner les lignes de CA** — trois natures, trois taux.
4. **Ne jamais taire une déclaration à 0 €** — celle du CA URSSAF reste due.

### Échéancier — `agents/echeancier/`

Trois couches, indépendantes du régime :

- **Rule Engine** (`data/regimes/*.yaml`) — règles d'obligations déclaratives, sourcées. Ajouter
  un régime = ajouter un fichier YAML, **jamais** toucher au code du moteur. Seul `micro.yaml`
  (micro-BNC / micro-BIC / mixte) est renseigné aujourd'hui ; réel et société restent un registre
  vide, prêt à remplir.
- **Decision Engine** (`moteur.py`) — fonction pure : profil → obligations applicables. Une
  obligation dont `applicable_si` ne correspond pas au profil n'apparaît jamais (pas de TVA ni de
  DES inventées pour un profil en franchise et sans clients UE).
- **Scheduler** (`dates.py`) — résout la prochaine occurrence. Les règles de calendrier stables
  (URSSAF, CFE) sont calculées ; celles qui sont une fenêtre, un « jour ouvré » ou qui dépendent
  d'un département inconnu restent une `fenetre_indicative` + lien officiel — **jamais une date
  exacte fabriquée**.

Les six sources de l'échéancier sont amorcées dans `data/sources.yaml` comme n'importe quelle
source de corpus, puis maintenues fraîches par `app/veille/scheduler.py`. `verifier_echeancier()`
recoupe le fait exact dont dépend chaque règle (`verif_motif`, par exemple « 15 décembre » pour la
CFE) avec la page officielle. Un écart est **signalé** (`echeancier_ecarts` dans
`GET /api/guidance/veille/last`) — `data/regimes/*.yaml` n'est jamais réécrit automatiquement.

### Veille réglementaire — `app/veille/`

```text
COLLECTE  →  QUALIFICATION  →  catalogue  →  DISTRIBUTION  →  fil / notifications
 (MCP)        (LLM, 1 fois)     (MongoDB)    (déterministe)
```

Le LLM qualifie chaque nouveauté **une seule fois**, en critères structurés. La confrontation au
profil de chaque utilisateur est ensuite purement déterministe : aucun appel LLM sur le chemin de
lecture, donc ni latence, ni coût, ni variation d'un chargement à l'autre.

Garanties : aucun chiffre non sourcé publié, pas de renotification (index unique
`(uid, nouveaute_id)`), obligations avant recommandations, plafond de 20 notifications par
semaine sans rien faire disparaître du fil, et un profil vide ne reçoit que les mesures
universelles.

Ce qui **n'est pas** garanti — exhaustivité, déduplication parfaite, exactitude du résumé,
détection des abrogations — est documenté sans détour dans
[docs/veille-personnalisee.md](docs/veille-personnalisee.md).

> Ne pas confondre `/api/veille/*` (veille personnalisée) et `/api/guidance/veille/*`
> (rafraîchissement du corpus RAG derrière le pédagogue). Deux sujets différents, coexistence
> volontaire.

---

## 8. Le moteur de calcul fiscal

**`backend/app/agents/impots`** — le seul endroit du dépôt où de l'argent est calculé.

| Fichier | Rôle |
|---|---|
| `constantes.py` | Lecture seule de `data/seuils.yaml` et `data/impot_revenu.yaml` ; une valeur absente lève `ConstanteManquante` |
| `moteur.py` | Abattements, base imposable, cotisations, CFP, IR au barème, quotient familial, décote, versement libératoire, plafonds, prorata, ACRE |
| `tools.py` | Fonctions pures exposables à un agent (arguments simples, résultat JSON) |
| `schemas.py` | Contrats d'entrée / sortie |

Trois principes portés par le code :

1. **Rien n'est inventé.** Sans contexte de foyer, l'IR au barème n'est pas calculé — il est
   déclaré non calculable.
2. **Pleine précision jusqu'au bout.** Les arrondis n'interviennent qu'à l'affichage ; arrondir
   les étapes fait dériver le barème.
3. **Toute approximation se signale.** L'ACRE appliquée au taux global, la décote « couple » non
   recoupée : ces réserves remontent dans le résultat.

**Aucun appel LLM ici, ni maintenant ni plus tard.** Un montant d'impôt doit être reproductible et
vérifiable ligne à ligne. `rapport_fiscal`, `declarations` et `api/simulation.py` appellent ce
moteur — ils n'écrivent aucune formule.

La note `NOTE-CALCULS-FISCAUX.pdf` est générée **depuis le moteur** : chaque taux y est lu à
l'exécution, jamais recopié. Une note recopiée dérive de son code au premier changement de loi de
finances ; celle-ci ne le peut pas.

---

## 9. Référence API

Base : `http://localhost:8000` · documentation interactive sur `/docs` · santé sur `/health`.

Sauf mention contraire, tous les endpoints exigent un JWT (`Authorization: Bearer …`).

### Authentification — `/api/auth`

| Méthode | Chemin | Description |
|---|---|---|
| `POST` | `/register` | Création du compte dans Mongo + JWT |
| `POST` | `/login` | Connexion + JWT |
| `GET` | `/me` | Compte courant + `agent_context` |
| `GET` | `/context` | Instantanés intake / guidance / capture / referral |

### Orchestrateur — `/api/orchestrator`

| Méthode | Chemin | Description |
|---|---|---|
| `POST` | `/start` | Crée la session, démarre l'intake ou la guidance |
| `POST` | `/turn` | Tour suivant (le compte doit posséder la session) |
| `GET` | `/my-sessions` | Sessions du compte |
| `GET` | `/session/{id}` | `UserProfile` courant |
| `GET` | `/session/{id}/detail` | Profil + diagnostic + feuille de route |
| `GET` | `/session/{id}/roadmap` | Feuille de route seule |

```json
// POST /start — branche A
{ "siret": "12345678900012" }
// POST /start — branche B
{ "skip_verification": true, "branch": "guidance" }
// POST /turn
{ "session_id": "<uuid>", "user_answer": "Prestation freelance" }
```

### Vérification — `/api/verification`

| Méthode | Chemin | Description |
|---|---|---|
| `POST` | `/siret` | Vérification SIREN / SIRET autonome |
| `POST` | `/ocr-siret` | OCR du SIRET depuis un fichier |
| `POST` | `/registry-document` | Dépôt multipart lié à un `session_id` (Kbis / RNE) |
| `POST` | `/sirene-avis` | Dépôt multipart de l'avis de situation SIRENE |

### Guidance — `/api/guidance` — *auth facultative*

Sans jeton, l'identité vient de l'en-tête `X-Anon-Id`.

| Méthode | Chemin | Description |
|---|---|---|
| `POST` | `/chat` | Un tour de conversation — `{session_id?, message, mode?, action?}` |
| `GET` | `/suggestions` | Suggestions d'ouverture, puis réponses rapides contextuelles + chips |
| `POST` | `/suggestions/affiner` | Chips affinées par LLM pour un champ ouvert (amélioration progressive) |
| `GET` | `/conversations` | Historique (filtré par espace) |
| `GET` | `/chat/{id}` | Conversation complète + profil + feuille de route + cases cochées |
| `PATCH` | `/chat/{id}/rename` | Renommer |
| `DELETE` | `/chat/{id}` | Supprimer |
| `GET` | `/profil` | Profil partagé + verdict déterministe + ce qui manque |
| `PATCH` | `/profil` | Correction manuelle depuis la fiche de statut |
| `DELETE` | `/profil/{field}` | Retirer un fait de la fiche |
| `GET`/`PUT` | `/roadmap/state/{id}` | État des cases, persisté côté serveur |
| `POST` | `/roadmap/pdf` | Feuille de route en PDF (`fpdf2`) |
| `POST` | `/ask` | Question fiscale ponctuelle — réponse + sources citées |
| `GET` | `/corpus` | État du corpus fiscal (nombre de chunks indexés) |
| `POST` | `/veille/run` | Un cycle de rafraîchissement du **corpus** |
| `GET` | `/veille/last` | Dernier rapport (actualités + contrôle des seuils + `echeancier_ecarts`) |

`POST /chat` renvoie `{session_id, reponse, profil, roadmap, options, suggestions,
suggestions_champ, profil_complet}`. `options` est une structure cliquable générique décidée par
le backend — le frontend la rend sans connaître le cas.

### Capture — `/api/capture`

| Méthode | Chemin | Description |
|---|---|---|
| `POST` | `/analyze` | Dépose une pièce et lance le graphe (multipart) |
| `POST` | `/answer` | Répond à la question du graphe (reprise du thread), ou interroge un document |
| `POST` | `/qa` | Question libre sur un document déjà traité |
| `GET` | `/invoices` · `/virements` · `/contrats` · `/cadeaux` | Listes par nature |
| `GET` | `/documents/{id}` | Fiche complète (+ `editable_fields`) |
| `PATCH` | `/documents/{id}` | Correction humaine de champs extraits (409 si cela crée un doublon) |
| `DELETE` | `/documents/{id}` | Suppression définitive, y compris la trace d'activité |
| `GET` | `/documents/{id}/file` | Pièce d'origine (types sûrs en `inline`, le reste en téléchargement) |
| `GET` | `/documents/{id}/messages` | Historique de discussion du document |
| `POST` | `/cadeau/estimer` | Propose une valeur depuis une photo — **n'enregistre rien** |
| `POST` | `/cadeau` | Déclare un cadeau — exige `valeur_confirmee` et `valeur_ttc > 0` |

### Facturation — `/api/facture` — *Premium + SIREN vérifié*

| Méthode | Chemin | Description |
|---|---|---|
| `POST` | `/brouillon` | Crée un brouillon — **aucun numéro consommé** |
| `PUT` | `/brouillon/{id}` | Remplace le contenu d'un brouillon (409 si déjà émise) |
| `DELETE` | `/brouillon/{id}` | Supprime un brouillon |
| `POST` | `/{id}/emettre` | Attribue le numéro, fige et date — existence fiscale |
| `POST` | `/{id}/avoir` | Avoir annulant tout ou partie ; l'original passe « annulée », jamais supprimé |
| `POST` | `/{id}/reglement` | Enregistre un règlement |
| `POST` | *(racine)* | Émission directe depuis le modèle standard |
| `POST` | `/depuis-template` | Idem depuis un template uploadé — repli systématique, jamais bloquant |
| `GET` | *(racine)* · `/{id}` · `/{id}/pdf` | Liste, détail, PDF |
| `DELETE` | `/{id}` | Supprime ; une facture émise exige `confirmer_suppression_emise=true` |
| `GET` | `/suppressions` | Numéros retirés de la séquence — de quoi justifier chaque trou |
| `GET` | `/contexte` | Émetteur, mentions applicables, champs manquants |
| `GET` | `/alerte-tva` | Position vis-à-vis des seuils de franchise + valeurs à vérifier en direct |

### Rapport fiscal — `/api/rapport-fiscal`

| Méthode | Chemin | Description |
|---|---|---|
| `GET` | `/contexte` | Contexte prérempli, origine de chaque champ, champs bloquants |
| `POST` | *(racine)* | Produit le rapport (assiette = CA encaissé) et l'archive |
| `GET` | *(racine)* · `/{id}` · `/{id}/pdf` | Liste, détail, PDF |
| `DELETE` | `/{id}` | Supprime un rapport archivé |

### Déclarations — `/api/declarations`

| Méthode | Chemin | Description |
|---|---|---|
| `GET` | `/contexte` | Situation déclarative telle que l'onboarding la connaît (préremplissage) |
| `GET` | `/echeances?annee=` | Calendrier de l'année + CA encaissé par période + prochaine échéance |
| `POST` | *(racine)* | Produit les cinq brouillons de la période, et les archive |
| `GET` | *(racine)* · `/{jeu_id}` | Jeux archivés, du plus récent au plus ancien ; détail |
| `GET` | `/{jeu_id}/dossier.pdf` | Le dossier complet en un seul PDF |
| `GET` | `/{jeu_id}/{type_declaration}.pdf` | Un document du jeu |
| `DELETE` | `/{jeu_id}` | Supprime un jeu |

> **Aucun endpoint ne transmet.** Il n'en existe pas, et un test le vérifie.

### Échéancier — `/api/echeancier` — *Premium + SIREN vérifié*

| Méthode | Chemin | Description |
|---|---|---|
| `GET` | `/agenda` | Obligations applicables, dates ou fenêtres, statuts, paramètres manquants |
| `PATCH` | `/parametres` | Enregistre les paramètres de calendrier (demandés en ligne, une seule fois) |
| `POST` | `/{obligation_id}/marquer-paye` | Confirmation déclarative — **le seul** chemin vers le statut « régularisée » |
| `GET` | `/historique` | Factures + déclarations préparées, du plus récent au plus ancien |

### Veille — `/api/veille`

| Méthode | Chemin | Description |
|---|---|---|
| `GET` | `?contexte=` | Le fil : nouveautés retenues, préférences, état du catalogue, champs de profil connus |
| `GET` | `/notifications?non_lues=` | Notifications enrichies du contenu de chaque nouveauté |
| `POST` | `/notifications/{id}/lue` | Marque une notification lue |
| `POST` | `/notifications/lues` | Marque tout lu (ou seulement les `ids` affichés) |
| `GET`/`PATCH` | `/preferences` | Veille active, mode `tout` / `obligatoire_seulement` |
| `POST` | `/run` | Déclenche un cycle à la main (diagnostic) |

### Scénarios — `/api/simulation`

| Méthode | Chemin | Description |
|---|---|---|
| `GET` | `/contexte` | Contexte prérempli depuis le profil et les factures réelles + champs manquants |
| `POST` | `/scenarios` | Calcule et compare les variantes (plafonds, alerte TVA incluses) |
| `POST` | `/interpreter` | Traduit une description en langage naturel en scénario structuré (**interprète, ne calcule pas**) |

### Expert-comptable — `/api/expert-comptable` et `/api/referral`

| Méthode | Chemin | Description |
|---|---|---|
| `GET` | `/api/expert-comptable?ville=` | Cabinets en sources officielles / ouvertes uniquement, avec le lien vers l'annuaire de l'Ordre |
| `POST` | `/api/referral/generate` | Recherche géolocalisée + brouillons d'e-mails personnalisés |
| `GET` | `/api/referral/history` | Recherches passées du compte |

### Assistant produit — `/api/product-assistant` — *public*

| Méthode | Chemin | Description |
|---|---|---|
| `POST` | `/chat` | Question sur le produit + réponse + références documentaires |
| `GET` | `/status` | Configuration, disponibilité, nombre de vecteurs du namespace |

### Chantiers antérieurs, conservés

| Préfixe | Ce qu'il fait | À utiliser à la place |
|---|---|---|
| `/api/rapport` | Rapport d'activité sur le **CA facturé** | `/api/rapport-fiscal` (CA encaissé) |
| `/api/declaration` (singulier) | 2042-C-PRO préparée depuis le CA facturé | `/api/declarations` (les cinq obligations, CA encaissé) |

Les deux restent montés et testés ; l'écran `/activite` s'appuie encore sur `/api/facture`.
Ne pas confondre les deux préfixes de déclaration — un script de migration
(`migrer_jeux_declarations`) a dû séparer leurs écritures dans une même collection.

---

## 10. Données : MongoDB et `data/*.yaml`

### Deux bases

| Base | Rôle | Créée par |
|---|---|---|
| `ledgermind` | Toutes les données métier | l'application |
| `ledgermind_checkpoints` | État interne du graphe LangGraph (capture) | la bibliothèque LangGraph |

La seconde n'est jamais lue par le code du projet. Ses volumes croissent à chaque analyse et
**ne sont jamais purgés automatiquement** : c'est le premier point à surveiller si la base
grossit anormalement.

Point d'entrée unique : `backend/app/core/mongo.py` (client partagé, créé une fois par processus).

### Le piège des identifiants

| Identifiant | Où | Désigne |
|---|---|---|
| `id` | `users.id` | le compte — un UUID |
| `user_id` | collections de capture | **le même** `users.id` |
| `uid` | collections guidance et production | **le même** `users.id` encore |
| `session_id` | `sessions.id` | un parcours d'orchestrateur, pas un compte |
| `document_id` | capture | une pièce déposée |
| `thread_id` | base de checkpoints | une exécution du graphe |

`user_id` et `uid` sont **deux noms pour la même clé de compte** : l'agent guidance a été porté
depuis un prototype qui disait `uid`. Ce n'est pas une distinction sémantique.

### Les collections

| Collection | Contenu |
|---|---|
| `users` | Compte, mot de passe haché (bcrypt), et `agent_context` (`intake`, `guidance`, `capture`, `referral`) |
| `sessions` | État sérialisé de l'orchestrateur (`state_json`) |
| `invoices` · `virements` · `contrats` | Pièces **reçues** (capture), une collection par nature, chacune avec sa clé de déduplication |
| `capture_files.*` | GridFS — les pièces d'origine (jusqu'à 20 Mo) |
| `chat_sessions` | Discussion par document |
| `fx_rates` | Cache de taux de change, avec la source du taux |
| `guidance_conversations` · `_messages` · `_profiles` · `_roadmaps` | Mémoire de l'espace guidance / pédagogue ; le **profil est partagé par compte**, pas par conversation |
| `factures_emises` · `factures_compteurs` | Factures **émises** + compteur de numérotation atomique |
| `rapports_generes` · `declarations_generees` | Archives : un rapport ou un jeu est **une photo** de la période |
| `echeances_statuts` | Confirmations manuelles « marqué comme payé » — jamais déduites |
| `corpus_chunks` | Corpus fiscal vectorisé (`chunk_id`, `texte`, `embedding`, `source`, `autorite`, `date_verification`, `concerne`) |
| `veille_nouveautes` · `_notifications` · `_preferences` | Catalogue partagé, qui a vu quoi, réglages |

⚠️ **Ne pas confondre `invoices` et `factures_emises`.** La première porte les factures **reçues**
(dépenses) ; la seconde les factures **émises** (recettes). Noms proches, sens opposés.

**Pas de migrations.** Chaque module crée ses index à la première écriture — une collection
n'existe donc pas tant que rien n'y a été écrit. Pas de suppression en cascade automatique
non plus : elle est écrite à la main (`delete_document` efface quatre traces).

**Recherche vectorielle** — la similarité cosinus est calculée en Python sur les vecteurs chargés
en mémoire, filtrés côté Mongo par public (`concerne`). Aucune base vectorielle ni modèle local
n'est ajouté au projet. Au-delà d'environ **50 000 chunks**, basculer sur un index
`vectorSearch` (MongoDB Atlas) derrière la même interface `query()`.

Tout le détail — index, miroirs de racine, dénormalisations assumées, commandes d'inspection —
est dans [docs/ARCHITECTURE-BASE-DE-DONNEES.md](docs/ARCHITECTURE-BASE-DE-DONNEES.md).

### Les fichiers `data/*.yaml`

Ce sont des **données produit**, revues à la main, versionnées pour que leur relecture soit
lisible dans les diffs Git. Chaque bloc porte sa `source` (URL officielle), son `annee` et sa
`date_verif` ; certains portent aussi `verifie: false` ou `verifier_en_direct: true`, ce qui
oblige le code à **le signaler à l'utilisateur** plutôt qu'à présenter la valeur comme fiable.

| Fichier | Contenu | À réviser |
|---|---|---|
| `seuils.yaml` | Plafonds micro, abattements, cotisations, franchise TVA, versement libératoire | à chaque loi de finances et revalorisation URSSAF |
| `impot_revenu.yaml` | Barème IR, quotient familial, décote, CFP, ACRE | à chaque loi de finances |
| `declarations.yaml` | Cases officielles, TFCC, seuil CFP, CFE, DES | quand une source officielle change |
| `facturation.yaml` | Mentions obligatoires (**texte affiché mot pour mot**), indemnité de recouvrement, délais, numérotation | idem |
| `sources.yaml` | Registre des sources du corpus, avec rang d'autorité (1 = loi, 2 = doctrine, 3 = guide) | à l'ajout d'une source |
| `regimes/micro.yaml` | Règles d'obligations du moteur d'échéances | à l'ajout d'un régime |

---

## 11. LLM contre déterministe

### Ce que le LLM fait

- Formuler les questions de l'intake, comprendre les réponses en texte libre (extraction JSON)
- Conduire la conversation de guidance et rédiger le court accompagnement de la feuille de route
- Rédiger une réponse fiscale **sur des extraits cités** (pédagogue) ou produit (Pinecone)
- Lire une pièce déposée : OCR, langue, extraction de champs, synthèse, catégorie de dépense
- Qualifier une nouveauté de veille en critères structurés — **une seule fois**, au moment de la
  collecte
- Rédiger l'appréciation narrative d'un rapport et les e-mails de prise de contact
- Interpréter un scénario décrit en langage naturel

### Ce qui doit rester déterministe

- **Tous les montants** (`agents/impots`)
- Les transitions de phase de l'orchestrateur
- Les recherches en registre et les règles d'incohérence
- Les outils de classification fiscale et de conformité
- L'**ordre des questions** de guidance et le « le profil est-il complet ? »
- `build_roadmap()` et toute décision de plafond ou de parcours
- La distribution de la veille aux utilisateurs
- L'applicabilité d'une obligation et le calcul de son échéance

### Toujours prévoir un repli

Questions statiques, regex, tables de réponses rapides, valeurs par défaut déterministes. Un
quota épuisé ne doit pas casser une démonstration : la feuille de route doit se construire même
si le texte d'accompagnement échoue.

**Le LLM n'invente jamais** un seuil, une liste d'étapes, un numéro de case, ou une conclusion
juridique qui contredirait le moteur.

---

## 12. Frontend

**Pile :** TanStack Start / Router · React 19 · Tailwind 4 · Vite · shadcn/ui (Radix) ·
Recharts · Leaflet · TanStack Query · Sonner.

### Routes — `src/routes/` (routage par fichiers)

| Fichier | Écran |
|---|---|
| `index.tsx` | Landing publique + chatbot produit |
| `auth.tsx` | Inscription / connexion |
| `premium.tsx` | Comparaison des formules |
| `onboarding.index.tsx` | Portail « ai-je un SIREN ? » |
| `onboarding.verification.tsx` | Branche A : vérification + dépôts |
| `onboarding.profil.tsx` | Branche A : chatbot de profil |
| `onboarding.diagnostic.tsx` | Branche B : chat (+ `<Outlet />` pour le résultat) |
| `onboarding.diagnostic.resultat.tsx` | Feuille de route |
| `education.tsx` | Assistant fiscal (public) |
| `dashboard.tsx` | Ma situation |
| `rapport.tsx` | Génération du rapport fiscal |
| `capture.tsx` | Versements (dépôt de pièces) |
| `activite.tsx` | Facturation |
| `declaration.tsx` | Déclarations |
| `simulateur.tsx` | Scénarios |
| `historique.tsx` | Flux unifié des pièces |
| `referral.tsx` | Expert-comptable |
| `parametres.tsx` | Compte et préférences |

### Composants notables — `src/components/lm/`

| Composant | Rôle |
|---|---|
| `AppShell.tsx` | Rail de navigation, thème, encart de formule, Centre d'Actions |
| `AccessGate.tsx` · `PremiumLock.tsx` | Verrouillage d'un écran selon `lockReason()` |
| `GuidanceChat.tsx` · `StatusCard.tsx` · `ConversationHistory.tsx` · `SuggestionChips.tsx` | Branche B |
| `Chatbot.tsx` | Chat partagé de l'orchestrateur (branche A) |
| `FiscalAssistant.tsx` · `Sources.tsx` · `Markdown.tsx` | Assistant fiscal et rendu des sources |
| `FactureCycleVie.tsx` | Cycle de vie complet d'une facture |
| `DocumentInspector.tsx` · `DocumentChatDrawer.tsx` | Fiche et discussion d'une pièce capturée |
| `GiftCadeauDrop.tsx` · `CadeauDeclaration.tsx` | Parcours cadeau en deux temps |
| `RapportFiscal.tsx` · `Declarations.tsx` | Panneaux métier du rapport et des déclarations |
| `ScenarioSaisie.tsx` · `ScenariosAnalyse.tsx` · `ScenariosCharts.tsx` · `ScenarioRecommandations.tsx` | Écran Scénarios |
| `Transactions*.tsx` | Flux unifié, filtres, résumés, anomalies |
| `CentreActions.tsx` | Agenda fiscal + veille, en panneau latéral |
| `CabinetsMap*.tsx` | Carte des cabinets (Leaflet, chargée à la demande) |
| `FiscalVisualisations.tsx` · `charts.tsx` · `FiscalReceipt.tsx` | Visualisations du tableau de bord |

### Clients et logique d'affichage — `src/lib/`

| Fichier | Rôle |
|---|---|
| `api.ts` | Client HTTP principal, types miroirs, helpers de session |
| `auth.ts` · `anon.ts` | Jeton, compte en cache, identité anonyme |
| `entitlements.ts` | **Droits d'accès, en un seul endroit** — les écrans consomment `lockReason()` |
| `plan.ts` | Formule Free / Premium (démo côté client, par compte) |
| `guidance-api.ts` · `facturation-api.ts` · `declarations-api.ts` · `rapport-fiscal-api.ts` · `echeancier-api.ts` · `veille-api.ts` · `product-assistant-api.ts` | Un client par domaine |
| `finance.ts` · `transactions.ts` · `scenarios*.ts` · `recommandations.ts` | Agrégations d'**affichage** uniquement — aucune règle fiscale |
| `theme.ts` · `voice.ts` · `error-capture.ts` · `reprise.ts` | Thème, dictée, remontée d'erreur, reprise de parcours |

> `useEntitlements()` partage **un seul** appel `/api/auth/me` via TanStack Query. Sans cette
> déduplication, une session de test avait produit 286 appels sur 448 requêtes — 64 % du trafic.

### Stockage navigateur

| Clé | Contenu |
|---|---|
| `ledgermind_access_token` · `ledgermind_user` | Jeton JWT et compte en cache |
| `ledgermind_session_id` | Session d'orchestrateur courante |
| `ledgermind_diagnostic_result` | Cache de la page de résultat (sessionStorage) |
| `ledgermind_scenarios_brouillon` | Brouillon de scénarios |
| `lm.anon_id` | Identité anonyme (en-tête `X-Anon-Id`) |
| `lm.plan.<uid>` | Formule du compte (démo) |
| `lm.theme` | Thème clair / sombre |

---

## 13. Tests

Depuis la **racine du dépôt**, venv actif :

```bash
pytest backend/tests -q                        # 741 tests
pytest backend/tests/test_impots_moteur.py -q   # un domaine
pytest backend/tests -q -k declarations         # par mot-clé
```

`pytest.ini` fixe `pythonpath = backend` et `asyncio_mode = auto`. MongoDB est substitué par
`mongomock` ; les appels LLM sont remplacés par des doublures (`app/agents/capture/tests/fakes.py`
et les fixtures locales). **Aucun test n'a besoin d'une clé d'API valide** — mais `config.py`
exige `GEMINI_API_KEY` dans `backend/.env` pour s'initialiser.

Les domaines les plus couverts :

| Fichiers | Ce qu'ils protègent |
|---|---|
| `test_declarations.py` (55) | Les quatre interdits de l'agent déclaratif ; l'exemple chiffré de la spécification est reproduit **au centime** |
| `test_facture_cycle_vie.py` (47) | Brouillon → émise → avoir → réglée, séquence de numérotation, suppressions tracées |
| `test_impots_moteur.py` (35) | Abattements, barème, décote, versement libératoire, plafonds, prorata, ACRE |
| `test_rapport_fiscal_*.py` (134 au total) | Rapprochement, cas limites, conformité au moteur, sources, PDF |
| `test_guidance_*.py` (71) | Conversation, feuille de route, schéma d'API, synchronisation du contexte |
| `test_capture_*.py` (83) | Documents, contrats, corrections, manuscrit, devises, hors périmètre |
| `test_cadeau.py` + `test_cadeaux_revenus.py` (39) | Cadeaux en nature : valeur confirmée, entrée dans l'assiette, cadeau non valorisé signalé |
| `test_veille_*.py` (49) | Personnalisation, notifications non renotifiées, écarts d'échéancier |
| `test_simulation.py` (28) | Scénarios : rien d'incalculable n'est présenté comme un zéro |

Quand vous changez un comportement d'extraction ou de feuille de route, **ajoutez un test
ciblé** : le LLM peut être indisponible ou limité en quota, en local comme en CI.

---

## 14. Ajouter une fonctionnalité

### A. Une nouvelle question de diagnostic (branche B)

1. Ajouter le champ à `DiagnosticProfile` dans `schemas/orchestrator.py`
2. Refléter le type dans `frontend/src/lib/api.ts` si l'interface en a besoin
3. Étendre `guidance/questions.py` (priorité des champs, replis, complétude)
4. Apprendre l'extraction à `guidance/understand.py` (réponse rapide + regex + LLM limité au champ)
5. Si cela change la feuille de route : mapper dans `to_roadmap_profil()`, puis ajuster `roadmap/`
   et `data/seuils.yaml`
6. Ajouter ou ajuster les tests dans `backend/tests/test_guidance_*.py`

### B. Un nouveau champ de profil intake (branche A)

1. Ajouter le champ sur `UserProfile`
2. L'enregistrer dans la priorité et les replis de `intake/questions.py`
3. Écrire l'extraction dans `intake/understand.py` ou `tools/extract_answer.py`
4. Si cela touche la fiscalité ou la conformité : `classify_tax.py` / `check_compliance.py`
5. Mettre à jour le frontend seulement si le champ est affiché

### C. Un nouveau calcul fiscal

**Toujours dans `agents/impots`**, jamais ailleurs.

1. La valeur réglementaire va dans `data/*.yaml`, avec `source` et `date_verif`
2. La lecture passe par `impots/constantes.py` (qui lève si la valeur manque)
3. La formule va dans `impots/moteur.py`, en pleine précision
4. Si un agent doit l'appeler, exposer une fonction pure dans `impots/tools.py`
5. Test dans `test_impots_moteur.py`, plus un test de non-régression côté agent appelant

### D. Un nouvel endpoint

1. Requête / réponse Pydantic dans `schemas/` (ou local au routeur si strictement interne)
2. Le routeur dans `api/` — **aucune logique métier**
3. La logique dans `agents/` ou `services/`
4. Documenter dans le tableau d'API de ce README

### E. Un nouvel écran

1. `frontend/src/routes/<nom>.tsx` (routage par fichiers)
2. Envelopper dans `<AccessGate feature="…">` et déclarer la `Feature` dans
   `lib/entitlements.ts` — ne pas recombiner les règles d'accès dans l'écran
3. Passer par un client de `src/lib/` ; **ne jamais dupliquer une règle fiscale dans le
   navigateur**
4. Route enfant ? Le parent doit rendre `<Outlet />`

### F. Un nouveau régime pour l'agenda fiscal

Ajouter `data/regimes/<regime>.yaml` avec ses obligations sourcées. Le moteur ne connaît aucun
régime en dur : **aucun code à modifier**.

### G. Changer un seuil légal

Éditer `data/*.yaml` (et les tests qui s'y adossent). Jamais dans du Python, jamais dans un
prompt. Si la valeur n'a pas été recoupée avec la source officielle, la marquer
`verifie: false` — le code s'en sert pour avertir l'utilisateur.

---

## 15. Conventions et pièges

1. **L'orchestrateur est la source de vérité** pour les transitions de phase — ne pas inventer de
   machine à états parallèle dans le frontend.
2. **Un champ par réponse en guidance** : `understand.py` limite la mise à jour au `target_field`,
   pour que le LLM ne remplisse pas tout le profil à partir d'une seule phrase.
3. **La feuille de route est déterministe** : le texte d'accompagnement peut échouer (quota), la
   feuille de route doit se construire quand même.
4. **Les routes enfants ont besoin de `<Outlet />`** — en particulier
   `onboarding.diagnostic` → `…/resultat`.
5. **CORS** : `FRONTEND_ORIGIN` doit correspondre à l'origine du navigateur. `localhost` et
   `127.0.0.1` sont deux origines différentes (`main.py` les reflète, mais mieux vaut le savoir).
6. **Ne jamais committer de secrets** : `.env` reste local, seul `.env.example` est partagé.
7. **Une correction de pièce doit mettre à jour les miroirs de racine**, sinon l'index de
   déduplication travaille sur des valeurs périmées et un vrai doublon passe.
8. **Une suppression doit nettoyer `agent_context`** : sans cela, une pièce effacée continue
   d'apparaître dans le fil d'activité.
9. **`invoices` ≠ `factures_emises`** — reçues contre émises. C'est l'erreur la plus facile à
   commettre.
10. **`/api/declaration` ≠ `/api/declarations`** — CA facturé contre CA encaissé, un document
    contre cinq.
11. **Petites PR** : agent, API et interface dans des commits distincts. Voir
    [CONTRIBUTING.md](CONTRIBUTING.md) et [.github/CODEOWNERS](.github/CODEOWNERS) — la relecture
    du propriétaire d'un dossier est demandée automatiquement.

---

## 16. Intégrations externes

| Service | Sert à | Code |
|---|---|---|
| [recherche-entreprises](https://recherche-entreprises.api.gouv.fr/) (api.gouv.fr) | Identité d'entreprise / agrégat SIRENE | `services/recherche.py`, `insee_sirene.py`, `inpi_rne.py` |
| **Mistral** | LLM + embeddings (guidance, pédagogue, veille, capture, produit) | `llm/mistral.py`, `agents/capture/app/mistral_client.py` |
| **Gemini** | LLM de l'intake + OCR de document de registre | `llm/gemini.py` |
| **MongoDB** | Toute la persistance + checkpoints LangGraph | `core/mongo.py` |
| **Pinecone** | Corpus du chatbot produit | `product_rag/pinecone_store.py` |
| **MCP** — Légifrance/PISTE, BOFiP, INSEE, docs officiels, sources web | Alimentation et contrôle du corpus, veille | `mcp/client.py`, `mcp_servers/` |
| PyMuPDF + RapidOCR (+ Tesseract en repli) | OCR de PDF et d'images | `services/ocr_*.py` |
| OpenStreetMap / Overpass + géocodage | Cabinets d'expertise comptable | `agents/referral/tools/` |
| BCE (+ source élargie) | Taux de change, mis en cache | `agents/capture/app/fx.py` |
| `fpdf2` / `pypdf` | PDF produits et assemblage du dossier déclaratif | `*/pdf.py` |

Sites officiels cités dans les textes d'interface, sans appel API : avis de situation SIRENE
(INSEE), greffe / RCS, Guichet unique INPI, annuaire de l'Ordre des experts-comptables.

---

## 13 bis. AI transparency (EU AI Act, Article 50)

Everything this product shows is produced by AI systems, so Article 50 of Regulation (EU)
2024/1689 applies throughout. It requires **two separate markings** — one is not a
substitute for the other:

| | What it is | Where it lives |
|---|---|---|
| **Visible** — art. 50(1), 50(4) | A human can tell AI was involved | `frontend/src/components/lm/AiLabel.tsx`, `lib/ai-act.ts`; in-page mention printed by `ai_act.filigrane_pdf()` |
| **Machine-readable** — art. 50(2) | Software can detect it after download or reshare | `backend/app/core/ai_act.py` — PDF document metadata, C2PA signature, HTTP headers, page `<meta>` + JSON-LD |

**The rule that shapes the design:** a marking that only exists in the page's DOM
disappears on export and is worth nothing. Anything the backend emits is written *into the
file*, not around it.

- **Chat surfaces** carry a first-contact disclosure before the first exchange (`AiChatNotice`).
  Voice mode also speaks it aloud — on that surface the user may not be looking at the screen.
- **Generated documents** carry both an in-page mention and metadata. C2PA does **not**
  cover PDF, so their machine-readable marking is metadata only — see
  [`backend/certs/README.md`](backend/certs/README.md).
- **Images, audio, video** can carry a signed C2PA manifest once a signing chain exists:
  `python backend/scripts/generer_cles_signature.py`.
- **Every API response** carries `X-AI-Generated` and friends, for clients that never touch
  our UI.
- `GET /api/ai-act/transparence` returns the live state of the whole mechanism — it is the
  audit documentation the guidance asks for, produced by the code rather than written
  alongside it, so it cannot drift.

Tests: `backend/tests/test_ai_act.py` opens the PDFs the product actually exports and checks
what is inside them, and signs a real image to read its manifest back.

---

## 14. Conventions & pitfalls

| Document | À lire quand |
|---|---|
| [DECLARATIONS-AGENT.md](DECLARATIONS-AGENT.md) | Vous touchez aux déclarations — les quatre interdits, les sources de l'assiette, la TVA du CA3, la détection des revenus UE, les valeurs à vérifier |
| [RAPPORT-FISCAL-HYPOTHESES.md](RAPPORT-FISCAL-HYPOTHESES.md) | Vous touchez au rapport fiscal — hypothèses du rapprochement, avantages en nature, ce que l'agent refuse de faire |
| [docs/ARCHITECTURE-BASE-DE-DONNEES.md](docs/ARCHITECTURE-BASE-DE-DONNEES.md) | Vous ajoutez une collection ou déboguez un index / un doublon |
| [docs/FACTURATION-VALEURS-REGLEMENTAIRES.md](docs/FACTURATION-VALEURS-REGLEMENTAIRES.md) | Vous révisez `data/facturation.yaml` après une loi de finances |
| [docs/veille-personnalisee.md](docs/veille-personnalisee.md) | Vous travaillez sur la veille — ce qui est garanti, ce qui ne l'est pas, points ouverts |
| [docs/AGENT2-INSIGHTS.md](docs/AGENT2-INSIGHTS.md) | Conception de l'agent d'insights post-immatriculation |
| `NOTE-CALCULS-FISCAUX.pdf` | Vous voulez la note de calcul, générée depuis le moteur |
| `docs/Guide_LedgerMind_Rapport_Fiscal.pdf` | Guide utilisateur du rapport fiscal |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Avant votre première PR |

---

## 18. Aide-mémoire

```bash
# Terminal 1 — MongoDB doit tourner
cd backend
uvicorn app.main:app --reload --port 8000       # venv actif, .env renseigné

# Terminal 2
cd frontend
npm run dev                                      # → http://localhost:3000
```

```bash
# Tests (depuis la racine)
pytest backend/tests -q

# Amorcer les corpus (une fois)
python -m backend.scripts.seed_corpus
python -m backend.scripts.index_product_knowledge

# Inspecter la base
mongosh ledgermind --eval "db.getCollectionNames()"
python backend/app/agents/capture/check_db.py
```

| Sanity check | Où |
|---|---|
| Backend en vie | `GET /health` |
| Endpoints disponibles | `/docs` |
| Corpus fiscal indexé | `GET /api/guidance/corpus` |
| Corpus produit indexé | `GET /api/product-assistant/status` |
| Dernier cycle de veille | `GET /api/guidance/veille/last` |

---

*Aligné sur l'état du dépôt en août 2026 : 16 routeurs HTTP, 14 agents, 741 tests, deux
fournisseurs LLM et deux corpus RAG.*
