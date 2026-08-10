# LedgerMind — Étude du business model

> **Version :** 1.0 — 8 août 2026
> **Objet :** modèle économique de la plateforme : proposition de valeur, segments, revenus, coûts, unit economics, projections, risques et chantiers de monétisation.

## Convention de lecture

Chaque affirmation est étiquetée pour que l'on sache toujours d'où elle vient :

| Étiquette | Signification |
|---|---|
| **[Dépôt]** | Fait vérifié dans le code ou la documentation du dépôt. Fiable. |
| **[Hypothèse]** | Estimation de travail. **À valider** avant tout usage externe (levée, jury, business plan officiel). La source à consulter est indiquée. |
| **[Décision]** | Recommandation de cette étude, à arbitrer par l'équipe. |

Les chiffres de marché et de coûts ci-dessous sont des **ordres de grandeur destinés à structurer le raisonnement**, pas des données sourcées. Aucun ne doit être repris tel quel dans un document officiel sans vérification à la source citée.

---

## 1. Résumé exécutif

LedgerMind est un **copilote fiscal français pour créateurs de contenu, influenceurs, freelances et indépendants** **[Dépôt]**. Le produit couvre déjà une chaîne fonctionnelle inhabituellement complète pour son stade : assistant fiscal sourcé, diagnostic avec ou sans SIRET, feuille de route, justificatifs OCR, facturation, rapport, déclaration pré-remplie, échéancier d'obligations et mise en relation avec un expert-comptable.

**Le modèle économique retenu aujourd'hui est un freemium à deux étages : Assistant fiscal à 0 € (sans compte, sans carte) et Premium à 29 €/mois sans engagement** **[Dépôt : `frontend/src/routes/premium.tsx`]**.

Trois constats structurent cette étude :

1. **L'économie unitaire est excellente, et ce n'est pas le sujet.** Le coût variable réel d'un utilisateur Premium est de l'ordre de **1 à 1,5 €/mois** (§7), soit une marge brute proche de **95 %**. Le facteur limitant n'est ni l'IA ni l'infrastructure : c'est le **coût d'acquisition** et le **churn saisonnier**.
2. **Le business model n'est pas encore branché.** Aucun encaissement n'existe : le passage en Premium est une bascule `localStorage` côté navigateur, sans endpoint de paiement, et **aucun contrôle de formule n'existe côté backend** **[Dépôt : `frontend/src/lib/plan.ts`, absence de gating dans `backend/app/api/`]**. En l'état, la totalité des fonctions Premium est accessible gratuitement à qui modifie une clé de stockage local. C'est le **chantier n° 1** (§12).
3. **Le différenciateur défendable est l'auditabilité, pas l'IA.** Moteurs déterministes, seuils versionnés et datés, réponses sourcées BOFiP/Légifrance/URSSAF, veille réglementaire qui *signale* les écarts sans jamais réécrire une règle **[Dépôt]**. Face à des concurrents qui vendent « de l'IA », LedgerMind peut vendre « une IA qui montre ses sources et refuse d'inventer une date » — un argument qui vaut prix premium auprès d'une cible que l'erreur fiscale terrifie.

---

## 2. Le produit tel qu'il existe : inventaire des actifs monétisables

Une étude de business model commence par ce qui est réellement livrable. **[Dépôt]** pour tout ce tableau.

| Actif | Statut réel | Valeur économique |
|---|---|---|
| **Assistant fiscal (RAG sourcé)** | Disponible, sans compte | Acquisition / SEO / preuve de sérieux. Coût, pas revenu. |
| **Diagnostic sans SIRET → feuille de route** | Disponible | **Cœur de la valeur payante.** Aucun concurrent généraliste ne traite le *pré-immatriculé*. |
| **Vérification SIRET (INSEE/INPI/RNE)** | Disponible | Fiabilise le dossier ; barrière à l'entrée technique. |
| **Justificatifs + OCR + détection de doublons** | Disponible | Rétention (les données s'accumulent → coût de sortie). |
| **Facturation (mentions sourcées, numérotation)** | Disponible | Usage récurrent mensuel = ancrage de l'abonnement. |
| **Rapport fiscal (chiffres déterministes + appréciation LLM encadrée)** | Disponible | Moment « aha » : l'utilisateur voit sa position vs. seuils. |
| **Déclaration pré-remplie, provenance par ligne** | Disponible, jamais transmise | Forte valeur perçue, forte responsabilité (§11). |
| **Centre d'Actions / échéancier** | Disponible (régime micro seulement) | Rétention hors saison ; raison de revenir chaque mois. |
| **Recherche d'expert-comptable + emails prêts** | Disponible (sources officielles/ouvertes, sans scraping) | Relais de revenu **potentiel mais réglementé** (§6.3). |
| **Veille réglementaire** | Disponible | Défend la promesse « jamais périmé ». Coût mutualisé. |
| **Transactions / Scénarios** | **Démonstration** (données statiques) | Non monétisable en l'état. |
| **Paiement Premium** | **Démonstration** (aucun encaissement) | **Bloquant.** |

**Lecture économique :** le gratuit produit de l'audience, le Premium produit de la valeur, et le tunnel entre les deux (`/education` → `/premium` → `/onboarding`) est le seul endroit où de l'argent peut apparaître. Tout l'effort de monétisation doit se concentrer là.

---

## 3. Problème et proposition de valeur

### 3.1 Le problème, formulé du point de vue du client

Un créateur qui commence à monétiser se retrouve simultanément face à quatre questions dont aucune n'a de réponse gratuite fiable :

1. **« Suis-je en règle ? »** — beaucoup encaissent avant d'être immatriculés, souvent sans le savoir.
2. **« Quel statut, quel régime ? »** — micro-BNC, micro-BIC, mixte, franchise de TVA : les seuils changent et l'information en ligne est périmée ou contradictoire.
3. **« Comment traiter *mes* revenus ? »** — sponsoring, affiliation, UGC, **cadeaux et dotations en nature**, revenus de plateformes étrangères, devises. C'est précisément ce que la comptabilité généraliste traite mal.
4. **« Qu'est-ce que je dois faire, et quand ? »** — URSSAF, TVA, CFE, IR : un calendrier que personne ne leur a donné.

L'alternative actuelle est binaire : **Google/ChatGPT** (gratuit, non sourcé, souvent faux) ou **un expert-comptable** (fiable, 80–150 €/mois, et souvent peu familier des revenus de création) **[Hypothèse : tarifs cabinets à vérifier auprès de l'Ordre des experts-comptables]**.

### 3.2 La proposition de valeur

> **Comprendre est gratuit. Agir change tout.** **[Dépôt : baseline de `/premium`]**

Formulée en termes de bénéfice :

| Pour qui | Douleur | Ce que LedgerMind apporte | Preuve dans le produit |
|---|---|---|---|
| Créateur non immatriculé | Peur de la régularisation | Diagnostic conversationnel + feuille de route déterministe | Branche B **[Dépôt]** |
| Micro-entrepreneur actif | Seuils, TVA, échéances | Tableau de bord + Centre d'Actions + provision fiscale | Échéancier **[Dépôt]** |
| Créateur en croissance | Facturer proprement, préparer sa déclaration | Facture → Rapport → Déclaration, chaque chiffre avec sa provenance | `/activite` **[Dépôt]** |
| Tous | « Est-ce que cette info est encore vraie ? » | Sources citées + alertes de fraîcheur + veille | RAG + `veille/` **[Dépôt]** |

### 3.3 Ce que LedgerMind **ne** vend **pas** (et c'est structurant)

**[Dépôt]** — LedgerMind ne transmet rien à l'administration, n'encaisse aucun paiement fiscal, ne se connecte à aucun compte bancaire, et ne constitue pas un conseil fiscal engageant.

Conséquences économiques directes :
- **Positif :** pas d'agrément, pas de flux financiers à sécuriser, responsabilité limitée, mise sur le marché rapide.
- **Négatif :** la valeur s'arrête au seuil de l'action. Le concurrent qui télétransmet capture le dernier kilomètre — celui pour lequel les gens paient le plus. **C'est le principal arbitrage stratégique du produit** (§10.3).

---

## 4. Segments de clientèle

### 4.1 Personas

| | **Léa — la créatrice qui décolle** | **Karim — le freelance installé** | **Sofia — la multi-plateforme** |
|---|---|---|---|
| Situation | Pas de SIRET, 8–15 k€/an de sponsos et affiliation | Micro-BNC, 35 k€/an, 3 clients | Micro mixte, 60 k€/an, UGC + ventes + plateformes étrangères |
| Douleur | « Je suis hors des clous et je ne sais pas par où commencer » | « Je perds du temps et j'ai peur d'oublier une échéance » | « Seuils de TVA, devises, cadeaux : personne ne sait me répondre » |
| Entrée produit | Branche B (diagnostic) | Branche A (SIRET) | Branche A + facturation |
| Consentement à payer | **Fort mais ponctuel** — la peur paie, puis retombe | **Moyen et régulier** | **Fort et durable** — l'enjeu financier est réel |
| Risque | Churn après régularisation | Comparaison prix avec Indy/Abby | Attend la télétransmission |

**[Décision]** Le segment à privilégier est **Sofia** : c'est le seul dont le consentement à payer *croît* avec le temps et pour qui les concurrents généralistes sont mal armés. Léa est un excellent moteur d'acquisition (viralité, contenu) mais un mauvais payeur long terme. Le modèle de revenus doit donc **convertir Léa en Sofia**, ce qui est exactement ce que fait la feuille de route.

### 4.2 Dimensionnement

**[Hypothèse — toutes les valeurs de cette section sont à sourcer]**

| Niveau | Définition | Ordre de grandeur | Source à consulter |
|---|---|---|---|
| **TAM** | Travailleurs indépendants en France | ~4 M | INSEE, « Emploi et revenus des indépendants » |
| | dont micro-entrepreneurs administrativement actifs | ~2,5–3 M | URSSAF, Observatoire de l'auto-entrepreneur |
| | dont économiquement actifs (CA > 0) | ~1,5–1,8 M | idem |
| **SAM** | Indépendants « digitaux » + créateurs monétisant | ~300–500 k | Croisement INSEE codes APE + études influence |
| | dont créateurs/influenceurs à revenus réguliers | ~100–150 k | Études sectorielles influence marketing FR |
| **SOM (3 ans)** | Part atteignable | **1,5–3 % du SAM créateurs**, soit **1 500 – 4 500 abonnés** | Objectif interne |

**SOM en revenu :** 1 500 à 4 500 abonnés × 29 € × 12 ≈ **520 k€ à 1,6 M€ d'ARR à horizon 3 ans**. C'est ambitieux mais pas absurde pour un SaaS B2C de niche bien exécuté — sous réserve que le churn soit maîtrisé (§7.3).

**Avertissement méthodologique :** un TAM de 4 M est trompeur. Le marché réellement adressable est celui des indépendants **qui ne veulent pas d'expert-comptable mais savent qu'ils ont un problème** — une population beaucoup plus étroite, et disputée. Mieux vaut construire le plan sur le SOM que sur le TAM.

---

## 5. Business Model Canvas

### ① Segments de clientèle
Créateurs de contenu et influenceurs monétisant (cœur) · Freelances et prestataires du numérique · Indépendants non immatriculés en phase de régularisation · **[Décision]** Relais B2B2C : agences d'influence / MCN, plateformes UGC et régies d'affiliation, cabinets d'expertise comptable, écoles et incubateurs.

### ② Proposition de valeur
« Passer de comprendre à agir, sans expert-comptable et sans se tromper. » Différenciateurs : **spécialisation créateur** (cadeaux, dotations, affiliation, multi-devises, plateformes) · **auditabilité** (chaque chiffre a sa provenance, chaque réponse ses sources) · **prise en charge du pré-immatriculé**, angle mort de tous les concurrents · **refus assumé d'inventer** (fenêtre indicative plutôt que fausse date).

### ③ Canaux
Recherche organique via l'assistant gratuit (contenu fiscal sourcé = actif SEO durable) · TikTok/Instagram/YouTube (le public *est* le canal) · Partenariats agences et plateformes · Bouche-à-oreille communautaire · **[Décision]** Prescription par les experts-comptables (retournement du concurrent en canal, §6.3).

### ④ Relation client
Self-service assisté par IA · Ton pédagogique, français simple, non culpabilisant **[Dépôt : contrainte explicite sur l'appréciation du rapport]** · Continuité du dossier (reprise de parcours, mémoire de conversation) · Escalade humaine vers un expert-comptable quand la limite du produit est atteinte.

### ⑤ Flux de revenus
Abonnement Premium récurrent (principal) · **[Décision]** Palier intermédiaire et engagement annuel (§6.2) · Licences B2B2C par sièges · Relais réglementés d'apport d'affaires (§6.3).

### ⑥ Ressources clés
**Le corpus fiscal sourcé, versionné et maintenu** (`data/seuils.yaml`, `data/sources.yaml`, `data/regimes/*.yaml`) — c'est l'actif propriétaire réel, pas le code **[Dépôt]** · Les moteurs déterministes (analyse juridique, comparateur, décision d'obligations) · Le pipeline de veille via MCP · La base d'utilisateurs et leurs dossiers · La marque « fiscalité des créateurs ».

### ⑦ Activités clés
Maintenance réglementaire (non négociable, permanente) · Amélioration de la fiabilité IA (guardrails, évaluation) · Acquisition et contenu · Conformité et documentation juridique.

### ⑧ Partenaires clés
Fournisseurs IA (Google Gemini, Mistral) **[Dépôt]** · Pinecone, MongoDB, hébergeur · Sources officielles via MCP (Légifrance/PISTE, BOFiP, INSEE, INPI, RNE, service-public) **[Dépôt]** · **[Décision]** Cabinets partenaires, agences d'influence, plateformes créateurs, futur opérateur de facturation électronique (§11.1).

### ⑨ Structure de coûts
Détaillée en §7. Dominée par les **coûts humains** (développement, maintenance réglementaire) et l'**acquisition**, pas par l'IA.

---

## 6. Modèle de revenus

### 6.1 Diagnostic de la grille actuelle

**[Dépôt]** Deux offres : 0 € et 29 €/mois sans engagement. Pas d'annuel, pas d'essai, pas de mention HT/TTC.

| Point | Évaluation |
|---|---|
| Prix de 29 € | **Cohérent.** Positionné entre les outils de facturation (~10–25 €) et un cabinet (~80–150 €), justifié par le périmètre. **[Hypothèse : repères concurrents à vérifier]** |
| Argument « le prix d'une heure de conseil, chaque mois » | **Excellent.** Ancre la valeur sur l'alternative, pas sur le coût. |
| Gratuit sans compte | **Ambivalent.** Superbe pour l'acquisition et le SEO ; mais aucune capture d'email, aucune relance possible, et coût non plafonné (§7.4). |
| Absence d'annuel | **Manque.** Coûte de la trésorerie et laisse le churn saisonnier intact. |
| Absence d'essai Premium | **Manque.** La valeur du Premium (feuille de route) n'est visible qu'*après* paiement — friction majeure. |
| HT/TTC non précisé | **Défaut juridique** à corriger avant toute vente à des consommateurs. |
| Palier unique | **Manque.** Pas de montée en gamme possible pour Sofia, pas d'entrée de gamme pour Léa. |

### 6.2 Grille recommandée **[Décision]**

| | **Découverte** | **Essentiel** | **Pro** | **Cabinet / Agence** |
|---|---|---|---|---|
| **Prix** | 0 € | **12 €/mois** ou 120 €/an | **29 €/mois** ou **290 €/an** | Sur devis, par siège |
| **Cible** | Tous, sans compte | Léa, Karim | Sofia | B2B2C |
| **Contenu** | Assistant fiscal sourcé, quotas | + diagnostic, feuille de route, échéancier, justificatifs (volume limité) | Tout : facturation, rapports, déclarations, scénarios, expert-comptable, justificatifs illimités | Multi-dossiers, tableau de bord agrégé, marque blanche partielle |

Justifications :

- **L'annuel à 290 € (2 mois offerts)** est la mesure la plus rentable de toute la grille : il encaisse 10 mois d'avance, neutralise le churn saisonnier post-déclaration, et améliore le ratio LTV/CAC sans toucher au prix affiché.
- **Le palier à 12 €** capte Léa, qui ne paiera pas 29 € pour une régularisation ponctuelle mais paiera 12 € pour être rassurée — et devient candidate à la montée en gamme quand son activité grossit.
- **Un essai de 14 jours sur le Pro**, ou mieux : **feuille de route générée gratuitement, actions verrouillées**. L'utilisateur voit son propre diagnostic — c'est le meilleur argument de vente que le produit possède, et le garder derrière le paywall est une erreur de tunnel.
- **[Attention]** Toute évolution tarifaire doit être répercutée dans `DOCUMENTATION_RAG_LEDGERMIND.md` et réindexée (`backend/scripts/index_product_knowledge.py`), sinon le chatbot produit annoncera l'ancienne grille **[Dépôt]**.

### 6.3 Relais de revenus secondaires — et leurs contraintes réelles

| Relais | Potentiel | **Contrainte à lever** |
|---|---|---|
| **Apport d'affaires expert-comptable** | Élevé : le produit qualifie le prospect mieux que n'importe quel annuaire | **Réglementé.** La déontologie de la profession comptable encadre le démarchage et la rémunération d'apporteurs. **À faire valider juridiquement avant toute modélisation de revenu.** Une commission illégale invalide la ligne. |
| **Affiliation banque pro / assurance RC pro** | Moyen | Le statut d'intermédiaire (IOBSP / courtage, immatriculation ORIAS) peut être exigé selon la forme de la rémunération. **À vérifier.** |
| **Licences B2B2C (agences, plateformes)** | **Élevé et non réglementé** | Aucune. Nécessite du multi-tenant, absent aujourd'hui. |
| **Données de marché agrégées et anonymisées** | Faible à moyen | RGPD, base légale, information des utilisateurs. Réputationnellement délicat sur des données fiscales. |
| **Contenu / formation créateurs** | Faible en revenu, **fort en acquisition** | Aucune. À traiter comme du marketing, pas comme un revenu. |

**[Décision]** Ne modéliser dans le business plan **que** l'abonnement et les licences B2B2C. Les relais réglementés sont des options à instruire, pas des revenus à projeter.

---

## 7. Structure de coûts et unit economics

### 7.1 Coût variable d'un utilisateur

**[Hypothèse — tarifs fournisseurs à revérifier sur leurs pages officielles ; les modèles utilisés sont `gemini-2.5-flash-lite` et `mistral-small-latest` + `mistral-embed` [Dépôt]]**

Base de calcul : ~5 000 tokens en entrée (question + extraits de corpus + prompt système) et ~600 tokens en sortie par message d'assistant, à des tarifs d'ordre 0,10 $/M en entrée et 0,40 $/M en sortie.

→ **≈ 0,0007 € par message.**

| Poste | Utilisateur gratuit (médian) | Utilisateur Premium |
|---|---|---|
| Assistant fiscal | ~8 messages → **0,006 €** | ~100 messages → **0,07 €** |
| Embeddings de requêtes | négligeable | négligeable |
| OCR justificatifs | — | ~30 documents → **0,05–0,15 €** |
| Appréciation LLM des rapports | — | ~2/mois → **0,005 €** |
| Génération PDF (facture, rapport, déclaration) | — | CPU seul → **~0** |
| **Sous-total IA/traitement** | **< 0,01 €** | **~0,25 €** |
| **Commission de paiement** (1,5 % + 0,25 € sur 29 €) | — | **~0,69 €** |
| **Total coût variable direct** | **< 0,01 €** | **≈ 0,95 €** |

**Constat marquant : la commission bancaire coûtera près de trois fois plus cher que l'intelligence artificielle.** Ce seul chiffre doit recadrer les discussions d'optimisation : chercher à réduire le coût des tokens est une perte de temps ; réduire le churn et privilégier l'annuel (une commission au lieu de douze) rapporte davantage.

### 7.2 Coûts fixes et mutualisés

**[Hypothèse]**

| Poste | Amorçage (0–200 users) | Croissance (~1 000 users) |
|---|---|---|
| MongoDB Atlas | 0–60 €/mois | 150–300 €/mois |
| Pinecone (corpus fiscal + produit) | 0–40 €/mois | 80–200 €/mois |
| Hébergement backend + frontend | 30–80 €/mois | 150–400 €/mois |
| Veille réglementaire (MCP + réindexation) | 20–60 €/mois | 60–150 €/mois |
| Observabilité, sauvegardes, domaines | 20–50 €/mois | 80–200 €/mois |
| **Infrastructure totale** | **~100–250 €/mois** | **~550–1 250 €/mois** |
| **Maintenance réglementaire humaine** | **le vrai coût fixe** — révision des seuils, des régimes, des sources | 0,3–0,5 ETP, soit **~2 000–4 000 €/mois** |
| RC professionnelle, juridique, comptabilité | 200–500 €/mois | 500–1 200 €/mois |

**Le coût structurant n'est pas technique.** Un corpus fiscal qui n'est pas maintenu devient un passif : il produit des réponses fausses avec l'autorité d'une source citée. Ce poste humain doit être budgété dès le premier euro de revenu — il ne disparaît jamais et ne se réduit pas avec l'échelle.

### 7.3 Marge, CAC, LTV

**[Hypothèse]**

| Indicateur | Valeur | Commentaire |
|---|---|---|
| ARPU | 29 €/mois (24,2 € HT si TVA 20 %) | **Clarifier HT/TTC : la TVA ampute l'ARPU de 17 %.** |
| Coût variable | ~1,0 € | §7.1 |
| **Marge brute variable** | **~96 %** (~93 % en HT) | Typique d'un SaaS pur |
| Churn mensuel | **6–10 %** | B2C indépendants ; **pic attendu après la déclaration annuelle** |
| Durée de vie moyenne | 10–16 mois | 1/churn |
| **LTV (marge brute)** | **230 – 380 €** | En HT et net de coûts variables |
| CAC organique / contenu | 20–50 € | Le plus rentable, le plus lent |
| CAC paid social | 80–150 € | Conversion essai→payant ~25 % |
| CAC partenariats | 30–70 € | Meilleur compromis volume/coût |
| **Ratio LTV/CAC visé** | **> 3** | Atteint si CAC mixte ≤ **90 €** |
| **Payback CAC** | **3–4 mois** | Acceptable ; l'annuel le ramène à ~1 mois |

**Conclusion des unit economics :** le modèle tient **à condition que le CAC mixte reste sous 90 € et le churn sous 8 %/mois**. Ce sont les deux seuls chiffres à surveiller en priorité. Tout le reste est du second ordre.

### 7.4 Risque de coût spécifique : le gratuit sans compte

**[Dépôt]** L'assistant fiscal est annoncé en questions illimitées, sans compte et sans carte.

En moyenne, le coût est dérisoire (§7.1). Mais **sans compte, il n'existe aucune unité à laquelle rattacher un quota** : un script peut consommer des milliers de messages, et 10 000 messages coûtent ~7 € — soit l'équivalent de la marge de sept utilisateurs Premium, dépensée par une seule boucle.

**[Décision]** Trois garde-fous, par ordre de priorité :
1. Limitation de débit par IP et par session, avec plafond quotidien global sur l'endpoint public.
2. Au-delà de N questions, demander un email (« pour retrouver vos réponses ») — transforme un coût en actif d'acquisition.
3. Réponses mises en cache pour les questions fréquentes : la fiscalité produit énormément de questions identiques, et un cache sémantique réduit le coût *et* la latence.

---

## 8. Projections financières à 3 ans

**[Hypothèse — modèle illustratif, à recalibrer après trois mois de données réelles]**

Hypothèses communes : mise en service du paiement au T4 2026 ; répartition mensuel/annuel 70/30 ; churn 8 %/mois la première année, 6 % ensuite ; ARPU mixte 26 € HT.

### Scénario médian

| | An 1 (2026-27) | An 2 (2027-28) | An 3 (2028-29) |
|---|---|---|---|
| Utilisateurs gratuits actifs | 8 000 | 35 000 | 90 000 |
| Taux de conversion vers payant | 1,2 % | 1,8 % | 2,2 % |
| **Abonnés payants (fin de période)** | **~100** | **~630** | **~2 000** |
| Revenu abonnements | ~22 k€ | ~145 k€ | ~470 k€ |
| Revenu B2B2C | 0 | ~15 k€ | ~80 k€ |
| **Chiffre d'affaires** | **~22 k€** | **~160 k€** | **~550 k€** |
| Coûts variables | ~2 k€ | ~12 k€ | ~40 k€ |
| Infrastructure | ~3 k€ | ~12 k€ | ~35 k€ |
| Maintenance réglementaire + équipe | ~40 k€ | ~130 k€ | ~300 k€ |
| Acquisition | ~10 k€ | ~55 k€ | ~150 k€ |
| **Résultat** | **~ -33 k€** | **~ -49 k€** | **~ +25 k€** |

**Seuil de rentabilité : environ 1 500 abonnés payants**, atteint courant An 3. Besoin de financement cumulé : **~90–120 k€** **[Hypothèse]**.

### Sensibilité

| Scénario | Hypothèse modifiée | Abonnés An 3 | CA An 3 |
|---|---|---|---|
| **Prudent** | Conversion 0,8 % / churn 10 % | ~800 | ~230 k€ |
| **Médian** | ci-dessus | ~2 000 | ~550 k€ |
| **Favorable** | Conversion 3 % + un partenariat plateforme structurant | ~5 000 | ~1,4 M€ |

**La variable la plus sensible est le taux de conversion gratuit → payant, loin devant le prix.** Une conversion qui passe de 1,2 % à 2,4 % double le chiffre d'affaires ; une hausse de prix de 29 à 39 € ne l'augmente que de 34 % et dégrade la conversion. **Toute l'énergie doit aller au tunnel, pas au tarif.**

---

## 9. Stratégie de mise sur le marché

### 9.1 Séquence recommandée **[Décision]**

**Phase 1 — Rendre le modèle encaissable (T3–T4 2026).** Paiement, droits côté serveur, mentions légales, CGV, résiliation. Sans cela, tout le reste est théorique.

**Phase 2 — Prouver la conversion sur un segment étroit (T4 2026 – T1 2027).** Une seule cible : les créateurs UGC/affiliation entre 15 et 70 k€ de CA. Objectif : 100 payants et une mesure fiable du churn et du CAC. Ne pas élargir avant d'avoir ces chiffres.

**Phase 3 — Industrialiser l'acquisition (2027).** Le contenu fiscal sourcé est un actif SEO composé : chaque réponse de l'assistant est une page potentielle. C'est le canal le moins cher et le plus défendable — un concurrent peut copier une fonctionnalité, pas trois ans de corpus indexé.

**Phase 4 — Ouvrir le B2B2C (2027-28).** Agences et plateformes : un contrat remplace mille acquisitions unitaires.

### 9.2 Le levier saisonnier

L'activité fiscale des indépendants est fortement saisonnière : pics à l'immatriculation (janvier, septembre), aux échéances URSSAF, et à la campagne déclarative annuelle (printemps). **[Décision]** Concentrer 60 % du budget d'acquisition sur ces fenêtres, et **pousser l'annuel juste avant la campagne déclarative** — c'est le moment où le consentement à payer est maximal et où l'engagement annuel neutralise le churn qui suit mécaniquement.

---

## 10. Concurrence et positionnement

### 10.1 Paysage

**[Hypothèse — positionnement et tarifs à vérifier sur les sites des acteurs]**

| Catégorie | Acteurs | Prix indicatif | Force | Faiblesse exploitable |
|---|---|---|---|---|
| Compta indépendants | Indy, Abby, Freebe, Tiime | ~10–30 €/mois | Synchronisation bancaire, télétransmission | Généralistes ; ne traitent ni les cadeaux, ni l'affiliation, ni le pré-immatriculé |
| Cabinets en ligne | Dougs, Keobiz, L-Expert-comptable | ~70–150 €/mois | Expert humain, responsabilité engagée | Prix, délai, faible culture créateur |
| Néobanques pro | Qonto, Shine | ~10–30 €/mois | Compte + outils intégrés | La fiscalité est un accessoire, pas le produit |
| IA généraliste | ChatGPT, Gemini | 0–25 €/mois | Gratuit, immédiat | **Non sourcé, périmé, aucun dossier, aucune traçabilité** |
| Contenu gratuit | URSSAF, service-public, blogs | 0 € | Autorité | Non personnalisé, illisible pour un débutant |

### 10.2 Positionnement retenu

> **Le seul outil fiscal qui parle la langue des créateurs et qui montre ses sources.**

Deux axes de différenciation, tous deux vérifiables dans le produit **[Dépôt]** :
1. **Verticalité créateur** — cadeaux et dotations, affiliation, UGC, plateformes, devises. Un concurrent généraliste ne peut pas l'imiter sans refaire son moteur de règles.
2. **Auditabilité** — provenance par ligne, seuils datés et sourcés, refus explicite d'inventer une date. À l'heure où la défiance envers les réponses d'IA augmente, c'est un argument commercial et non un détail technique.

### 10.3 La faiblesse à assumer ou à combler

LedgerMind **ne se connecte pas aux comptes bancaires** et **ne télétransmet pas** **[Dépôt]**. Or c'est précisément ce que vend Indy pour un prix inférieur.

**[Décision]** Deux voies, à trancher explicitement par l'équipe — ne pas laisser cette question implicite :

- **Voie A — Assumer.** Rester un copilote de compréhension et de préparation, vendre la verticalité et la traçabilité, et faire de la mise en relation avec un expert-comptable le dernier kilomètre. Coût faible, plafond de valeur plus bas, risque juridique minimal.
- **Voie B — Combler.** Agrégation bancaire (via un agrégateur agréé DSP2) puis télétransmission. Multiplie la valeur perçue et le consentement à payer, mais introduit agréments, conformité, sécurité des données bancaires et un coût de développement d'un autre ordre.

**Recommandation : Voie A jusqu'au seuil de rentabilité, puis réévaluer.** La Voie B avant d'avoir prouvé la conversion consommerait toute la trésorerie sur un pari non validé.

---

## 11. Risques

### 11.1 Réglementaire

| Risque | Gravité | Traitement |
|---|---|---|
| **Facturation électronique obligatoire (réforme française en cours de déploiement)** | **Élevée** | Le module de facturation devra émettre dans un format conforme via une plateforme agréée. **Le calendrier et les obligations exactes sont à vérifier sur impots.gouv.fr** : ils ont été modifiés à plusieurs reprises. Devenir opérateur agréé est hors de portée ; **se raccorder à une plateforme partenaire est la voie réaliste**. À instruire dès maintenant : c'est à la fois le risque le plus sérieux et la plus grande opportunité de différenciation. |
| Évolution des seuils et régimes | Moyenne | Déjà traitée par `seuils.yaml` versionné + veille **[Dépôt]**. Point fort du produit. |
| Frontière avec l'exercice illégal de l'expertise comptable | Moyenne | Disclaimers présents **[Dépôt]** ; **à faire valider par un avocat**, notamment pour la déclaration pré-remplie qui approche la limite. |
| Rémunération d'apport d'affaires vers un expert-comptable | Moyenne | §6.3 — à valider avant toute modélisation. |
| Obligations B2C : information précontractuelle, résiliation en ligne, droit de rétractation | Moyenne | **Non traité aujourd'hui.** Bloquant pour la vente. |

### 11.2 Technologique et opérationnel

| Risque | Traitement |
|---|---|
| **Réponse fiscale erronée présentée comme sourcée** | Le risque le plus grave pour la réputation. Jeu de tests d'évaluation sur questions fiscales de référence, exécuté à chaque évolution du corpus ou du modèle. |
| Dépendance à Gemini et Mistral | **[Dépôt]** le README signale un plafond quotidien en offre gratuite Gemini — inacceptable en production. Abstraction fournisseur + budget payant. |
| **Transferts de données hors UE** | Gemini implique un traitement hors UE. **[Décision]** Basculer l'ensemble des traitements portant sur des données de dossier vers **Mistral (UE)** : simplification RGPD **et** argument commercial de souveraineté auprès d'une cible française. |
| Concentration fournisseurs (Pinecone, Atlas) | Acceptable à ce stade ; documenter la réversibilité. |
| **Absence de contrôle de formule côté serveur** | **[Dépôt]** — voir §12, chantier n° 1. |

### 11.3 Marché et financier

- **Churn saisonnier** — le risque n° 1 du modèle. Traitement : annuel, échéancier comme raison de revenir hors saison, valeur accumulée dans les justificatifs.
- **Un concurrent installé qui verticalise sur les créateurs** — la fenêtre d'avance est de 12 à 18 mois. La défense est le corpus et la marque, pas les fonctionnalités.
- **Conversion inférieure à 1 %** — scénario prudent (§8). Réponse : ouvrir la feuille de route gratuitement pour rendre la valeur visible avant paiement.
- **Sous-capitalisation** — besoin de ~90–120 k€ **[Hypothèse]**. La saisonnalité impose une réserve de trésorerie sur les creux.

---

## 12. Ce qu'il faut construire pour que le business model existe

Classé par ordre de blocage. **[Dépôt]** pour les constats, **[Décision]** pour les priorités.

| # | Chantier | Constat | Priorité |
|---|---|---|---|
| **1** | **Droits d'accès côté serveur** | La formule est stockée dans `localStorage` (`frontend/src/lib/plan.ts`) et aucun endpoint backend ne vérifie la formule. **N'importe qui peut débloquer tout le Premium en modifiant une clé de stockage.** Le champ de formule doit vivre sur le document utilisateur en base, et chaque route Premium doit le vérifier. | **Bloquant absolu** |
| **2** | **Encaissement** | Aucun endpoint de paiement, aucune intégration Stripe **[Dépôt]**. Checkout + webhooks + réconciliation. | **Bloquant** |
| **3** | **Documents juridiques** | CGV, mentions légales, politique de confidentialité, sous-traitants (DPA), mention HT/TTC. | **Bloquant** |
| **4** | **Gestion d'abonnement en libre-service** | Aucune interface de résiliation aujourd'hui **[Dépôt]**, alors que Premium est annoncé « sans engagement ». Obligation légale autant qu'attente client. | **Haute** |
| **5** | **Facturation de l'abonnement lui-même** | Émettre les factures d'abonnement conformes. Le produit sait déjà générer des factures : réutiliser le module. | Haute |
| **6** | **Quotas et limitation de débit sur le gratuit** | §7.4 | Haute |
| **7** | **Instrumentation du tunnel** | Aucune mesure de conversion aujourd'hui. Sans elle, le chiffre le plus sensible du modèle (§8) est invisible. | Haute |
| **8** | **Finaliser Transactions et Scénarios** | Aujourd'hui statiques **[Dépôt]** : vendus dans Premium mais non livrés. Risque commercial *et* juridique. | Moyenne |
| **9** | **Palier intermédiaire + annuel** | §6.2 | Moyenne |
| **10** | **Multi-tenant pour le B2B2C** | Prérequis des licences agences. | Basse (An 2) |

**À noter :** les chantiers 1 à 3 représentent un effort modeste au regard de ce qui est déjà construit. La plateforme est fonctionnellement très avancée et commercialement à zéro — c'est un déséquilibre rare, et facile à corriger.

---

## 13. Indicateurs à instrumenter

| Famille | Indicateur | Cible **[Hypothèse]** |
|---|---|---|
| **Acquisition** | Visiteurs uniques → sessions assistant | — |
| | Coût d'acquisition par canal | < 90 € mixte |
| **Activation** | % de visiteurs posant ≥ 1 question | > 40 % |
| | % créant un compte | > 8 % |
| | **% terminant la mise en route** | **> 60 %** — l'indicateur le plus prédictif de la rétention |
| **Revenu** | Conversion gratuit → payant | > 1,5 % An 1, > 2,5 % An 3 |
| | Part d'abonnements annuels | > 30 % |
| | MRR, ARR, ARPU | §8 |
| **Rétention** | Churn mensuel, **churn post-campagne déclarative** | < 8 % / < 15 % |
| | Utilisateurs actifs mensuels / abonnés | > 60 % |
| **Qualité** | Taux de réponses avec source citée | > 95 % |
| | Écarts détectés par la veille et délai de correction | < 7 jours |
| **Coût** | Coût IA par utilisateur actif | < 0,50 € |
| | Marge brute | > 90 % |

---

## 14. Synthèse et recommandations

**Ce qui est solide :** un périmètre fonctionnel large et cohérent, un différenciateur défendable (verticalité créateur + auditabilité), une économie unitaire à ~95 % de marge, un prix bien positionné et bien argumenté, et un actif propriétaire réel — le corpus fiscal sourcé et maintenu.

**Ce qui manque :** le business model n'est pas branché. Pas d'encaissement, pas de droits côté serveur, pas de cadre juridique de vente, pas de mesure de conversion.

**Les cinq décisions à prendre maintenant :**

1. **Sécuriser et encaisser** — chantiers 1 à 3 du §12, avant toute autre chose. Tant que la formule vit dans le navigateur, il n'y a pas de modèle économique, seulement une démonstration.
2. **Ouvrir la feuille de route gratuitement** — le meilleur argument de vente du produit est actuellement invisible avant paiement. C'est le levier le plus rentable sur la conversion, qui est la variable la plus sensible du modèle.
3. **Lancer l'annuel à 290 €** — trésorerie immédiate et neutralisation du churn saisonnier, sans toucher au prix affiché.
4. **Trancher explicitement la question du dernier kilomètre** (§10.3) — Voie A recommandée jusqu'au seuil de rentabilité.
5. **Instruire la facturation électronique dès maintenant** (§11.1) — c'est simultanément la principale menace sur le module de facturation et la plus grande opportunité de différenciation à 18 mois.

**Ce qui reste à valider avant tout usage externe :** l'ensemble des éléments marqués **[Hypothèse]** — dimensionnement de marché (INSEE, URSSAF), tarifs concurrents (sites des acteurs), tarifs fournisseurs (pages officielles), calendrier de la facturation électronique (impots.gouv.fr), et le cadre déontologique de l'apport d'affaires vers un expert-comptable (Ordre des experts-comptables, avis d'un avocat).

---

*Document de travail interne. Les chiffres non sourcés sont des hypothèses de raisonnement et ne constituent ni une projection engageante ni un conseil financier ou juridique.*
