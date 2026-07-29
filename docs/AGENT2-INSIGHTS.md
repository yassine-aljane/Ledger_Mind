# Agent « Recommandations & Insights » — Architecture (conception)

> Statut : **document de conception**, aucune ligne de code encore. Destiné à l'espace de
> l'influenceur **déjà immatriculé** (SIREN, factures, virements, contrats saisis) — donc à
> **l'Agent 2** (repo/service distinct), pas à l'Agent 1 (onboarding) qui héberge ce document.
>
> Objectif : générer des conseils **proactifs, actionnables et défendables** sur trois axes —
> (1) **provisionnement fiscal prédictif** (« tax safety »), (2) **contrôle activité réelle vs
> déclarée**, (3) **détection de typologies de blanchiment / fraude**, dans une logique de
> **protection de l'utilisateur** (éviter pénalités et requalification), jamais d'évasion.

---

## 0. Méthode de conception : chaque fonctionnalité pour elle-même

**Pas de dogme transversal.** L'Agent 1 (onboarding) impose « le LLM ne fait que rédiger » parce que
son domaine est du droit dur : c'est *son* bon choix, pas une loi universelle. Cet agent-ci traite
trois problèmes de natures différentes, et **chacun reçoit l'approche qui lui convient**, argumentée
séparément — déterministe, statistique ou génératif selon ce que le problème exige réellement :

| Axe | Nature dominante du problème | Approche retenue (justifiée dans sa section) |
|---|---|---|
| **A — Provision fiscale** | droit dur (taux) + incertitude (CA futur) | déterministe sur les taux, **statistique sur le CA**, LLM pour le récit |
| **B — Écart réel/déclaré** | rapprochement factuel + indices faibles | **déterministe** (réconciliation) au socle, signaux comme modulateurs |
| **C — AML / typologies** | jugement contextuel + explicabilité | **règles + anomalies**, avec un **rôle réel du LLM** dans l'analyse contextuelle |

Le seul invariant commun n'est pas une méthode, c'est une **exigence** : chaque conseil doit être
**explicable** (motif lisible) et **honnête** (fiable, gratuit là où on le prétend, non accusatoire).
Comment on l'atteint varie d'un axe à l'autre.

---

## 1. Axe A — Provisionnement fiscal prédictif (« tax safety »)

### 1.1 Décomposition du problème

Pour un micro-entrepreneur influenceur, la charge fiscale/sociale d'une période est **déterministe**
une fois le CA connu :

```
charge(période) = cotisations_URSSAF(CA)              # taux légal selon BNC/BIC/Cipav
                + impôt_revenu(CA)                     # versement libératoire OU barème progressif
                + CFE (annuelle, forfaitaire)
                + TVA due si franchissement de la franchise en base
```

Aucun de ces termes n'est à « apprendre » : ce sont les règles déjà encodées côté Agent 1
(`data/seuils.yaml`, `decide_regime`). **Le seul terme incertain est le CA futur.**

> **Décision d'architecture n°1** : réutiliser le moteur de seuils déterministe de l'Agent 1 comme
> **module partagé** (`fiscal_core`) plutôt que le redévelopper. À extraire dans un package commun
> versionné, importé par les deux agents.

### 1.2 Ce qu'on prédit et comment on s'en sert

On prédit la **distribution** du CA des N prochains mois (pas seulement la moyenne). Le
provisionnement « safety » consiste à **mettre de côté sur un quantile haut**, pas sur l'espérance :

- provision = `charge_déterministe( quantile_P80..P90(CA_prévu) )`
- rationnel : sous-provisionner = pénalités URSSAF/majorations ; sur-provisionner = trésorerie
  immobilisée. L'asymétrie du coût justifie de viser **P80–P90**, paramétrable (« prudence »).

Sortie type : *« Pour l'échéance URSSAF du T2, mets de côté ~1 480 € (fourchette 1 250–1 700 €).
Tu as déjà provisionné 900 € → ajoute ~110 €/semaine sur 5 semaines. »*

### 1.3 Choix du modèle de prévision — **argumenté**

Contrainte dominante : **peu de données** (historique mensuel de quelques mois à 2–3 ans),
saisonnalité marquée (campagnes de fin d'année, creux estival), revenus « lumpy » (gros contrats
ponctuels). Dans ce régime, la précision brute compte moins que la **calibration de l'incertitude**.

| Modèle | Verdict | Pourquoi |
|---|---|---|
| Deep learning (LSTM, N-BEATS, TFT) | **Rejeté** en v1 | overfit garanti avec < 36 points ; boîte noire ; coûteux ; non explicable au fisc |
| SARIMA | Possible mais **secondaire** | puissant mais instable à faible n, sélection d'ordre fragile, sensible aux ruptures |
| **Lissage exponentiel ETS (Holt-Winters)** | **Recommandé (défaut)** | robuste à faible n, saisonnalité additive/multiplicative, **intervalles de prédiction natifs**, rapide, explicable |
| Décomposition type Prophet | **Alternative** si ≥ 24 mois | gère tendances + saisonnalité + points de rupture, intervalles bayésiens, tolère les trous |
| Baseline « seasonal naïve » + marge | **Toujours calculée** | garde-fou : tout modèle qui ne bat pas la baseline en backtest est écarté |

> **Décision d'architecture n°2** : **sélection automatique par backtest glissant** (validation
> temporelle, `TimeSeriesSplit`) évaluée à la **pinball loss** sur les quantiles cibles (pas au RMSE
> de la moyenne — on optimise la qualité du quantile P85, pas du point). Le modèle retenu est celui
> qui **couvre correctement** l'intervalle (couverture empirique ≈ nominale) ET bat la baseline.

**Cold start** (nouvel influenceur, < 6 mois d'historique) : **pas de modèle statistique**. Repli
100 % déterministe : provision = taux effectif appliqué au **CA courant annualisé prudemment**
(dernier trimestre extrapolé, plafonné au P90 empirique du secteur si disponible). On l'annonce
explicitement (« estimation prudente en attendant plus d'historique »), comme le fait déjà l'Agent 1
avec ses hypothèses prudentes.

**Stack** : `statsmodels` (ETS/SARIMA, gratuit, pur Python), `Prophet` optionnel. **Aucun GPU,
aucune dépendance lourde** — cohérent avec la contrainte du projet.

### 1.4 Signaux exogènes (améliorent la prévision sans la complexifier)

Régresseurs optionnels branchés sur le modèle : **carnet de contrats signés** (revenu futur déjà
contractualisé = quasi certain → réduit fortement l'incertitude sur les mois couverts), saisonnalité
calendaire, historique de retards de paiement. Le carnet de contrats transforme une partie de la
prévision en **déterministe** — encore une fois, on ne prédit que ce qui reste incertain.

---

## 2. Axe B — Contrôle « activité réelle vs déclarée » (détection d'écart)

Objectif : détecter un **écart significatif** entre l'activité **observée** et l'activité **déclarée
sur la plateforme**, pour alerter l'utilisateur *avant* le fisc. Contrainte imposée : **fiable,
faisable, accès gratuit**.

### 2.1 Colonne vertébrale : la réconciliation bancaire (fiable + gratuite)

La source la plus fiable et **déjà disponible** = les **virements saisis** par l'utilisateur. On
rapproche de façon **déterministe** :

```
factures émises  ⟷  encaissements (virements)   → matching (montant, date, émetteur, tolérance)
```

- **Encaissements non rattachés à une facture** = revenus perçus mais potentiellement non déclarés.
- Règle d'écart graduée : `taux_écart = encaissements_non_facturés / CA_déclaré`
  - < 5 % → RAS (bruit : arrondis, remboursements, apports perso à exclure via catégorisation).
  - 5–15 % → information (« régularise ces X encaissements »).
  - > 15 % → alerte forte (« risque de requalification / rappel — voici comment régulariser »).

C'est **déterministe, explicable, gratuit** : chaque alerte pointe des lignes précises. C'est la v1.

> **Décision d'architecture n°3** : la détection d'écart est **fondée sur la réconciliation
> bancaire déterministe**. Les signaux externes (ci-dessous) ne servent qu'à **moduler un score de
> confiance**, jamais à accuser seuls.

**Accès aux mouvements bancaires — honnêteté sur le « gratuit »** :
- **v1 : import manuel / CSV** du relevé (ce que fait déjà l'app avec les virements saisis) — gratuit.
- **v2 : agrégation DSP2 / open banking** (Bridge, Powens, Nordigen/GoCardless) — fiable et
  automatique mais **payant** (ou quotas gratuits très limités). À documenter comme option, pas comme
  socle. Ne jamais prétendre que l'open banking temps réel est « gratuit ».

### 2.2 Signaux publics (corroboration, best-effort, jamais une preuve)

Estiment un **CA plausible** à confronter au déclaré :

| Source | Gratuité / fiabilité | Usage |
|---|---|---|
| **YouTube Data API** | quota gratuit, officielle, stable | volume/vues/fréquence → proxy d'activité |
| Instagram/TikTok API | **restreint/payant**, fragile | à traiter en option ; scraping = fragile + risque ToS |
| Nb de **posts sponsorisés** publics × **fourchette tarifaire** marché | approximatif | borne basse/haute d'un CA « plausible » |

Ces signaux alimentent un **CA plausible [min, max]**. Si `CA_déclaré ≪ min_plausible` **et** que la
réconciliation bancaire confirme, le score d'écart monte. **Seuls, ils ne déclenchent rien** :
imprécis, non probants, sensibles aux ToS.

> Position claire : signaux sociaux = **indice contextuel** modulant la confiance, **jamais** la base
> d'une accusation. Toute alerte reste ancrée sur des **flux financiers réels**.

---

## 3. Axe C — Détection de typologies de blanchiment / fraude (AML)

### 3.1 Cadrage juridique et éthique (à trancher AVANT de coder)

- **L'app n'est pas (a priori) un assujetti LCB-FT** au sens du CMF : **pas de déclaration Tracfin**,
  pas de gel d'avoir, pas de KYC réglementaire imposé. Le positionnement est **outil de conformité au
  service de l'utilisateur** : on **détecte, on explique, on aide à régulariser**.
- **Frontière déontologique non négociable** : l'outil aide à **devenir conforme**, **jamais** à
  « passer sous les radars ». Concrètement — on ne dira **jamais** *« fractionne pour rester sous le
  seuil déclaratif »* ; on dira *« ce fractionnement ressemble à une typologie surveillée : régularise
  et documente l'origine des fonds »*. Cette règle est un **invariant du prompt** de rédaction (voir §4.3).
- **Disclaimer** systématique : l'agent n'est pas expert-comptable ni avocat fiscaliste ; il **signale
  et oriente**, il ne se substitue pas à un professionnel.

### 3.2 Méthode : typologies explicables + anomalies statistiques

Deux couches, **toutes deux explicables** (une alerte AML opaque est inutilisable et anxiogène) :

**(a) Moteur de règles — typologies FATF/Tracfin transposées à un indépendant :**
- **Structuration / fractionnement** : multiples encaissements juste sous un seuil déclaratif/rond.
- **Incohérence flux ↔ activité** : entrées sans facture ni contrat correspondant.
- **Versements de tiers non liés** à une prestation identifiable.
- **Espèces** anormales ; **virements internationaux** depuis juridictions à risque (liste GAFI).
- **Allers-retours** (mêmes fonds entrant/sortant rapidement).
- **Ruptures brutales** de volume sans justification (contrat, saisonnalité).

**(b) Détection d'anomalies statistique** (complément, pas remplacement) :
- z-score / IQR sur montants et fréquences ; éventuellement **Isolation Forest** *si* on garde une
  **explication par contribution de features** (sinon on s'en passe : l'explicabilité prime).

**Scoring** : chaque signal → sévérité + **raison lisible** + **action de régularisation**. On agrège
en un score gradué. **Aucune alerte sans motif humainement compréhensible.**

### 3.3 Formulation orientée protection

Sortie type : *« 6 encaissements de 990–999 € en 3 semaines depuis un même tiers : ce motif
ressemble à une typologie que l'administration surveille. Ce n'est pas une accusation — mais pour
éviter une requalification, documente l'origine de ces fonds et rattache-les à un contrat/facture. »*

---

## 4. Architecture technique & intégration

### 4.1 Où vit l'agent

Repo/service **Agent 2** (immatriculés). Ce repo (Agent 1) contribue **un module partagé** :

> **Décision d'architecture n°4** : extraire le **moteur fiscal déterministe** (`seuils.yaml` +
> `decide_regime` + calcul de charges) en package versionné `fiscal_core`, importé par les deux
> agents. Évite la divergence des règles légales entre onboarding et pilotage.

### 4.2 Pipeline (rôle du LLM ajusté par axe)

```
Ingestion (factures, virements, contrats, activité déclarée, signaux publics)
        │
        ├─▶ Réconciliation bancaire (déterministe)            ── Axe B
        ├─▶ Prévision CA (ETS/Prophet, intervalles)           ── Axe A (partie incertaine)
        │        └─▶ fiscal_core (déterministe) ─▶ provision quantile
        └─▶ Moteur de règles Insights :
               • rentabilité / seuil            (déterministe)
               • écart réel vs déclaré          (Axe B)
               • typologies AML                 (Axe C)
        │
        ▼
   JSON d'insights structuré  (scores, montants, fourchettes, lignes en cause, sources, actions)
        │
        ▼
   Couche LLM CONTRAINTE + VALIDÉE  →  nudges rédigés (récit, ton bienveillant)
        │                               (le LLM ne calcule rien, ne cite aucun chiffre non fourni)
        ▼
   API /insights  +  jobs planifiés (APScheduler, comme la veille)  +  persistance
```

**Le rôle du LLM n'est pas le même partout** — on le calibre par axe :

| Axe | Rôle du LLM | Pourquoi |
|---|---|---|
| **A — Provision** | **rédaction seule**, chiffres verrouillés (patron `guidance.py` : prompt anti-invention + validateur + repli) | un euro provisionné est un fait déterministe ; aucune latitude |
| **B — Écart** | **rédaction + hiérarchisation** des lignes en cause | les montants viennent du code ; le LLM priorise et met en récit |
| **C — AML** | **rôle analytique réel** : le LLM aide à **qualifier le contexte** d'un motif suspect (un versement de tiers est-il plausible vu les contrats ?), propose une **hypothèse d'explication** et l'action de régularisation | ici l'incohérence n'est pas purement numérique : elle est **contextuelle et narrative**, terrain où le LLM apporte une vraie valeur — sous garde-fous |

### 4.3 Garde-fous, dosés selon le rôle

- **Axe A** : tout chiffre absent du JSON est interdit ; validateur strict ; repli déterministe.
- **Axe C** : le LLM peut **raisonner**, mais chaque alerte reste **ancrée sur une ligne financière
  réelle** (jamais une alerte « inventée » sans transaction sous-jacente) et **jamais** un conseil qui
  reviendrait à échapper à un contrôle (frontière §3.1). Sa sortie est **revue** : sévérité et lignes
  en cause proviennent du moteur ; le LLM habille et explique, il ne crée pas l'alerte.
- **Commun** : ton préventif et non culpabilisant, orienté action ; disclaimer « pas un
  expert-comptable » sur les insights fiscaux/AML.

### 4.4 Modèle de données (interfaces d'entrée — esquisse)

```
Facture(id, date, montant_ht, tva, client, statut, contrat_id?)
Virement(id, date, montant, sens, emetteur, categorie?, facture_id?)   # rapproché ou non
Contrat(id, client, montant, date_debut, date_fin, echeancier[])       # revenu futur (quasi) certain
ActiviteDeclaree(periode, ca_declare, regime, tva_regime)
SignalPublic(source, periode, metrique, valeur)                        # optionnel, best-effort
Insight(type, severite, score, montant?, fourchette?, lignes[], sources[], action, explication)
```

### 4.5 Planification

Recalcul **mensuel/trimestriel** (échéances URSSAF) + à chaque nouvel import de virement, via
`APScheduler` (déjà présent pour la veille). Les insights sont **persistés et horodatés** (traçabilité,
comme les déclarations archivées).

---

## 5. Conformité, RGPD, limites

- **RGPD** : données bancaires + signaux sociaux = données personnelles sensibles → **consentement
  explicite**, **minimisation** (ne stocker que l'utile), **finalité** documentée, droit à
  l'explication (chaque score est justifiable), suppression sur demande.
- **Explicabilité** : aucun score « boîte noire » exposé sans motif lisible.
- **Non-substitution** : l'agent oriente, il ne remplace ni expert-comptable ni fisc.
- **Honnêteté sur le gratuit** : réconciliation manuelle/CSV et YouTube API = gratuits ; open banking
  temps réel et APIs sociales complètes = **payants** → documentés comme options, jamais comme socle.

---

## 6. Phasage proposé (chantiers)

| Chantier | Contenu | Dépend de |
|---|---|---|
| **I1 — `fiscal_core` partagé** | extraire seuils + calcul de charges déterministe | Agent 1 |
| **I2 — Réconciliation + rentabilité** | matching facture↔virement, seuil de rentabilité, provision **déterministe** (cold start) | I1 |
| **I3 — Prévision CA** | ETS/Prophet + backtest quantile → provision « safety » P80–P90 | I2 |
| **I4 — Écart réel/déclaré** | score d'écart bancaire + intégration signaux publics (confiance) | I2 |
| **I5 — AML** | typologies + anomalies, scoring explicable, nudges de régularisation | I2 |
| **I6 — Couche LLM insights** | rédaction contrainte + validée + repli, endpoint `/insights`, planification | I2–I5 |

Chaque chantier est **livrable seul** et **testable** (comme `tests/test_roadmap.py`), le déterministe
d'abord, le probabiliste ensuite, le rédactionnel en dernier.

---

## 7. Synthèse des décisions

1. **On prédit le CA, jamais l'impôt** — le fiscal reste 100 % déterministe (`fiscal_core` partagé).
2. **Modèle de prévision = ETS/Holt-Winters par défaut**, Prophet en alternative ≥ 24 mois, DL rejeté ;
   **sélection par backtest à la pinball loss** ; **provision sur quantile P80–P90**, pas la moyenne ;
   **cold start** = repli déterministe prudent.
3. **Détection d'écart = réconciliation bancaire déterministe** (gratuite, fiable) comme socle ;
   signaux sociaux = **corroboration** modulant la confiance, jamais une preuve.
4. **AML = typologies explicables + anomalies statistiques**, positionnées comme **protection de
   l'utilisateur** ; **frontière déontologique** : aider à se conformer, jamais à échapper au contrôle.
5. **Rôle du LLM dosé par axe** — rédaction verrouillée sur la provision (A), rédaction +
   hiérarchisation sur l'écart (B), **analyse contextuelle réelle** sur l'AML (C, sous garde-fous) :
   pas de dogme unique, la bonne approche pour chaque cas.
