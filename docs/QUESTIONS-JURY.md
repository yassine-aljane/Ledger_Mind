# Questions du jury — fiches de réponse

Une fiche par question. Chaque affirmation renvoie au fichier qui la porte, et chaque fiche se
termine par ce qui **n'est pas** garanti : le jury cherche moins une promesse qu'une conscience
des limites.

---

# 1. Mise à jour de l'assistant juridique

> **Comment LedgerMind garantit que l'assistant reste à jour avec l'évolution des lois,
> réglementations et textes juridiques ?**

## Réponse courte (30 secondes)

Aucune règle de droit n'est écrite dans le code. Le droit vit dans **deux réservoirs séparés** —
les *valeurs* (seuils, taux, échéances) dans des fichiers YAML versionnés, sourcés et datés ; les
*textes* dans un corpus vectoriel — et **une veille quotidienne** va reconfronter les deux aux
sources officielles de l'État via des serveurs MCP (Légifrance/PISTE, BOFiP en vigueur,
impots.gouv.fr, URSSAF, DGCCRF, Service-Public).

Trois principes gouvernent cette mise à jour :

1. **Le code ne connaît aucun chiffre.** Il lit `data/seuils.yaml`. Une loi de finances se
   répercute en modifiant une donnée, pas une ligne de logique.
2. **La machine détecte, l'humain décide.** La veille signale un écart entre une valeur du projet
   et sa source ; elle **n'écrase jamais** la valeur automatiquement.
3. **La réponse porte sa propre date de péremption.** Chaque extrait cité affiche sa source, son
   URL et sa date ; au-delà de 120 jours sans reconfirmation, la réponse est marquée comme
   potentiellement périmée — dans l'API comme à l'écran.

## Les quatre couches, en détail

### Couche 1 — Les valeurs numériques : une source de vérité unique, sourcée et datée

`data/seuils.yaml` porte en en-tête la règle du projet : *« AUCUN seuil, taux, coût ou URL ne doit
être codé en dur dans la logique. Toute valeur fiscale vit ici, avec sa source officielle et sa
date de vérification. »*

Chaque bloc porte quatre métadonnées : `valeur`, `annee` (année de validité), `source` (URL
officielle), `date_verif` (date du dernier contrôle) — 14 `date_verif` distinctes aujourd'hui.

```yaml
micro:
  bnc:
    seuil: 83600
    annee: 2026
    source: "https://entreprendre.service-public.gouv.fr/vosdroits/F32353"  # CGI art. 102 ter
    date_verif: "2026-07-23"
```

Même principe pour les échéances déclaratives (`data/regimes/micro.yaml`) et les mentions
obligatoires de facturation (`data/facturation.yaml`, documenté dans
[FACTURATION-VALEURS-REGLEMENTAIRES.md](FACTURATION-VALEURS-REGLEMENTAIRES.md)).

**Conséquence pour le jury :** la question « que faites-vous si le plafond micro change en 2027 ? »
a une réponse d'une ligne — on édite une valeur YAML. Pas de recherche dans le code, pas de
régression possible sur la logique de calcul.

### Couche 2 — Le contrôle automatique de ces valeurs

`backend/app/veille/scheduler.py` confronte chaque valeur à sa propre source :

| Fonction | Ce qu'elle vérifie | Verdict |
|---|---|---|
| `verifier_seuils()` ([scheduler.py:72](../backend/app/veille/scheduler.py#L72)) | Les 5 seuils critiques (micro-BNC, micro-BIC, franchise TVA base/majoré) apparaissent-ils encore dans la page officielle ? | `confirme` / `ecart_possible` / `inaccessible` |
| `verifier_echeancier()` ([scheduler.py:108](../backend/app/veille/scheduler.py#L108)) | Le fait clé de chaque obligation (`verif_motif` : « 15 décembre » pour la CFE, « 1er mai », « tous les 3 mois »…) figure-t-il toujours à la source ? | idem |

La comparaison est robuste aux artefacts d'extraction : `_valeur_presente()` retire espaces,
insécables et points de milliers avant de chercher le nombre ; `_motif_present()` supprime *toutes*
les espaces, parce que certaines extractions HTML/PDF insèrent une espace parasite dans les
ordinaux (« 1 er mai ») et produiraient un faux écart sur un texte pourtant inchangé.

**Le point à défendre : la valeur n'est jamais écrasée.** Un écart part en `logger.warning` et dans
le rapport lisible sur `GET /api/guidance/veille/last`. La correction reste une décision humaine.
C'est un choix assumé : laisser un LLM réécrire un seuil fiscal à partir d'une page web mal
extraite, c'est accepter qu'une hallucination devienne la source de vérité du calcul d'impôt.

### Couche 3 — Le corpus textuel : amorcé, puis tenu vivant

**Amorçage.** `data/sources.yaml` déclare le socle documentaire (loi Influenceurs 2023-451,
URSSAF, Service-Public, DGFiP, DGCCRF, Douane…), chaque entrée portant son **rang d'autorité** :
`1` = loi/décret (Légifrance), `2` = doctrine officielle (BOFiP/URSSAF/impots.gouv.fr), `3` =
guide ou source privée. `backend/scripts/seed_corpus.py` télécharge et ingère ce socle.

**Rafraîchissement quotidien.** `start_scheduler()` planifie un cycle à `VEILLE_CRON_HOUR` (6 h
par défaut) qui enchaîne `run_veille()` puis le cycle de veille personnalisée :

```
COLLECTE (MCP)  ──►  QUALIFICATION (LLM, 1×)  ──►  RÉ-INGESTION  ──►  CONTRÔLE DES VALEURS
```

Quatre serveurs MCP, quatre voies d'accès au droit vivant :

| Serveur MCP | Source réelle | Ce qu'il apporte |
|---|---|---|
| `legifrance` | API **PISTE de l'État** (`api.piste.gouv.fr`), OAuth | Textes de rang légal ; `code_article(code="CGI", article="155 B")` interroge le code en vigueur |
| `bofip` | dataset **`bofip-vigueur`** (data.economie.gouv.fr) | Doctrine fiscale **en vigueur** — un texte abrogé disparaît du dataset lui-même |
| `web-sources` | URSSAF, DGCCRF, ARPP, impots.gouv.fr, Service-Public | `check_updates()` détecte les pages modifiées par **diff de hash SHA-256** depuis le dernier passage |
| `docs-officiels` | pages ciblées (loi de finances 2026, BOSS avantages en nature, actualités DGFiP) | Récupération d'une page précise par clé ou URL |

Chaque candidat est résumé et classé une fois par le LLM (`_resumer_et_classer`), écarté s'il ne
concerne pas les créateurs/indépendants, puis ré-ingéré dans le corpus avec sa source, son URL et
son rang d'autorité.

**La ré-ingestion met à jour, elle n'empile pas.** L'identifiant de chunk est déterministe —
`sha1(url|titre)` + index ([ingest.py:58](../backend/app/rag/ingest.py#L58)) — et le stockage fait
un `update_one(..., upsert=True)` sur cet identifiant. Repasser sur une page mise à jour **remplace
son contenu en place** : le corpus ne contient donc pas deux versions contradictoires du même
texte.

**L'autorité départage.** À la recherche, le score est pondéré par le rang :
`{1: 1.0, 2: 0.9, 3: 0.75}` ([retriever.py:17](../backend/app/rag/retriever.py#L17)). À pertinence
sémantique comparable, c'est la source la plus opposable qui remonte — vérifié par
`test_autorite_departage_a_pertinence_egale`.

### Couche 4 — Ce que l'assistant fait quand il n'est pas sûr

Trois garde-fous sur le chemin de la réponse ([pedagogue/agent.py](../backend/app/agents/pedagogue/agent.py)) :

**Le repli BOFiP en direct.** Si le meilleur extrait local a une similarité < `0.80`, le corpus est
jugé faible sur la question : la doctrine BOFiP **en vigueur** est interrogée en direct et le
meilleur résultat live prend la place du 8ᵉ extrait local. L'assistant n'est donc pas prisonnier de
la dernière date de collecte.

**Le drapeau de fraîcheur.** `is_stale()` compare `date_verification` — mise à jour à chaque
passage de la veille sur le document — au plafond `freshness_max_days` (**120 jours**). Nuance
importante et voulue : le drapeau mesure *le temps écoulé depuis la dernière reconfirmation à la
source*, pas l'âge du texte de loi. Une source recollectée chaque nuit ne se périme jamais ; une
source dont le serveur MCP est injoignable depuis 4 mois allume le drapeau. Il remonte dans la
réponse API (`avertissement_fraicheur`) et à l'écran
([FiscalAssistant.tsx:143](../frontend/src/components/lm/FiscalAssistant.tsx#L143)). Vérifié par
`test_avertissement_fraicheur`.

**L'interdiction d'inventer.** Le prompt système impose : *« N'INVENTE JAMAIS un chiffre, un seuil,
un taux, une date ou un article de loi absent des extraits »*, la citation entre crochets
`[Source — Titre]`, et le renvoi vers impots.gouv.fr ou un expert-comptable quand le détail chiffré
manque. Chaque réponse retourne jusqu'à 6 sources avec **URL et date de publication** : c'est
l'utilisateur qui peut vérifier, et c'est ce qui rend l'obsolescence détectable de l'extérieur.

Deux comportements de repli explicites plutôt que silencieux : corpus vide → *« Ma base
documentaire n'est pas encore prête »* ; embeddings indisponibles → *« je préfère ne rien affirmer
plutôt que de répondre sans source »* (`test_corpus_vide_ne_declenche_aucune_recherche`,
`test_embeddings_indisponibles_ne_renvoient_rien`).

## Le volet notification : l'utilisateur est prévenu, il n'a pas à demander

Rester à jour ne suffit pas si l'utilisateur doit deviner de poser la question. Le second cycle
alimente un **catalogue de nouveautés** confronté au profil de chaque utilisateur par des règles
**déterministes, sans appel LLM à la lecture** — mêmes profil et catalogue ⇒ même fil, sans
latence ni variation. Les obligations passent devant les recommandations, et une nouveauté sans
URL ou adossée à la seule presse n'est jamais publiée (`test_la_presse_seule_ne_publie_rien`,
`test_sans_url_rien_nest_publiable`).

Détail complet et garanties formelles : [veille-personnalisee.md](veille-personnalisee.md).

## Ce qui n'est PAS garanti — à dire avant qu'on le demande

**L'exhaustivité.** L'agent ne voit que les sources branchées. Une mesure publiée ailleurs n'existe
pas pour lui. **LedgerMind n'est pas un substitut à un expert-comptable**, et l'assistant le dit
lui-même : *« tu informes et tu orientes »*, pas de conseil fiscal engageant.

**Les abrogations.** L'agent voit ce qui paraît, pas ce qui cesse de s'appliquer. Au niveau de la
doctrine, le dataset `bofip-vigueur` protège partiellement (un texte abrogé en sort). Mais une
mesure abrogée déjà ingérée dans le corpus local y reste jusqu'à sa péremption par ancienneté.

**Les chunks orphelins.** La ré-ingestion écrit par index de chunk. Si la nouvelle version d'une
page est plus courte que l'ancienne, les chunks de queue de l'ancienne version subsistent en base.
Correctif connu, non encore appliqué : purger les `chunk_id` du même document au-delà du nouveau
compte.

**Le titre comme partie de l'identifiant.** `sha1(url|titre)` : si une source change son titre, la
mise à jour crée un nouveau document au lieu de remplacer l'ancien. Compromis assumé — mieux vaut
un doublon qu'un écrasement erroné.

**Le seuil de 120 jours** (`freshness_max_days`) est un choix de prudence, pas un résultat calibré.

**Le cycle n'a jamais tourné en conditions réelles** : les serveurs MCP n'étaient pas joignables
pendant le développement (PISTE exige des identifiants OAuth). La collecte est testée **par
substitution**, pas de bout en bout. C'est la limite la plus honnête à énoncer — et le premier
travail d'une mise en production.

## Ce qu'on peut montrer en démonstration

1. `data/seuils.yaml` — la source de vérité unique, `source` + `date_verif` sur chaque valeur.
2. `POST /api/guidance/veille/run` puis `GET /api/guidance/veille/last` — un cycle à la demande et
   son rapport (nouveautés, écarts de seuils, écarts d'échéancier).
3. Une question à l'assistant fiscal → les sources citées avec URL et date sous la réponse.
4. `pytest backend/tests/test_pedagogue_rag.py backend/tests/test_veille_personnalisee.py` — les
   garanties énoncées ci-dessus sont vérifiées, pas seulement affirmées.

## Si le jury demande « en une phrase, la garantie ? »

> Nous ne garantissons pas de connaître le droit à jour — personne ne peut le garantir. Nous
> garantissons qu'aucune règle n'est figée dans le code, que chaque affirmation est adossée à une
> source officielle datée et vérifiable par l'utilisateur, qu'un écart avec la source est détecté
> automatiquement mais corrigé par un humain, et qu'une réponse dont les sources n'ont pas été
> reconfirmées depuis 120 jours le dit à l'écran.

---

## Point à corriger avant la soutenance

La docstring de [scheduler.py:11](../backend/app/veille/scheduler.py#L11) affirme *« La veille est
désactivée par défaut (`VEILLE_ENABLED=false`) »*, alors que
[config.py:36](../backend/app/config.py#L36) porte `veille_enabled: bool = True`. Un membre du jury
qui lit le fichier y verra une contradiction. C'est la docstring qui est périmée.
