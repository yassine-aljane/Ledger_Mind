# Rapport fiscal — hypothèses retenues et points à vérifier en direct

Ce document accompagne l'agent `app/agents/rapport_fiscal`. Il répond à deux questions :
**qu'est-ce que l'agent décide de lui-même**, et **quels chiffres doivent être recoupés avant
tout usage déclaratif**.

---

## 1. La règle qui commande tout

> **L'assiette imposable est le chiffre d'affaires ENCAISSÉ, jamais le facturé.**

Une facture émise et non payée ne compte pas pour la période. Elle comptera pour celle où le
virement arrive. Toute l'architecture découle de là : c'est pourquoi l'agent rapproche les
factures des virements au lieu de sommer les factures.

**Un seul rapport.** Le CA facturé n'est pas un rapport concurrent : il figure DANS le rapport,
à côté de l'encaissé (`ca_facture_periode`), avec l'écart entre les deux. Un écart positif
signale du facturé pas encore rentré ; un écart négatif, des encaissements de périodes
antérieures. Aucun des deux n'est une anomalie en soi, et aucun ne sert au calcul de l'impôt.

## 1 bis. Ce que chaque source apporte — et ne doit pas apporter

| Source | Rôle | Entre dans l'assiette ? |
|---|---|---|
| Virements reçus, rapprochés | **l'assiette** | **oui**, une fois convertis en HT |
| Factures émises | rapprochement + indicateur « facturé » | non |
| Contrats capturés | revenu engagé, charge de travail | **jamais** — un contrat engage, il n'encaisse pas |
| Dépenses capturées | mesure de marge réelle | **jamais** — l'abattement forfaitaire remplace la déduction des frais réels |
| Profil d'onboarding | préremplit le contexte de calcul | non (c'est un paramètre, pas une recette) |

Deux pièges volontairement évités :

- **Un contrat de travail** apparaît dans la liste des contrats mais est exclu du total
  « revenu contractuel engagé », et signalé par une alerte : un salaire se déclare en
  traitements et salaires, pas en chiffre d'affaires.
- **Les dépenses ne réduisent rien.** En micro, les compter allégerait l'impôt à tort. Elles
  sont affichées avec cette mise en garde à côté du total.

---

## 1 ter. Ce que le rapport expose, étape par étape

La spécification du moteur exige que le rapport montre **le chemin du calcul**, pas seulement
son résultat : un chiffre sans le taux qui l'a produit ni la source de ce taux n'est pas
opposable.

| Section | Contenu | D'où elle vient |
|---|---|---|
| Catégorie fiscale | `BIC_VENTE` / `BIC_SERVICE` / `BNC` appliquées | déclarée à l'onboarding, ou déduite des lignes de facture |
| Détail du calcul | CA, abattement, base, cotisations, CFP, IR, total, net, taux effectif | `moteur.simuler_impots` |
| Barème vs versement libératoire | les deux montants, l'option retenue, la justification | `moteur.simuler_impots` |
| Contrôle du plafond micro | plafond, CA, ✓ conforme / ⚠ dépassement, marge restante | `moteur.verifier_plafonds` |
| Prorata 1re année | date de création, jours, plafond réduit, méthode | `moteur.plafond_applicable` |
| Franchise de TVA | ✓ conservée / ⚠ seuil de base / ⚠ seuil majoré | `data/seuils.yaml` — **drapeau seul** |
| ACRE | oui/non, réduction, trimestres restants, fin estimée | `data/impot_revenu.yaml` + date de début |
| Paramètres appliqués | abattement, cotisations, CFP, versement libératoire, plafond | `moteur.parametres_categorie` |

**Le calcul est toujours effectué**, y compris à CA nul. Zéro est un résultat, pas un trou :
l'ancien message « aucun calcul n'a été effectué » se lisait comme une panne alors que tous les
montants valaient légitimement zéro. Seul le **taux effectif** reste à `None` — le rapport
prélèvements / CA n'a pas de sens sans CA, et il s'affiche « non applicable » plutôt que 0 %.

## 2. Ce que l'agent ne fait pas

- **Il ne calcule aucun impôt.** Tout passe par `app.agents.impots.tools`. Deux implémentations
  du même calcul finiraient par diverger ; il n'y en a donc qu'une.
- **Il ne liquide aucune TVA.** Il compare le CA aux seuils de franchise et signale la position.
  Rien de plus (voir § 5).
- **Il n'invente aucun montant.** Un champ `null` veut dire « non calculé » et s'affiche ainsi,
  jamais « 0 € » — un refus de calculer ne doit pas se lire comme « rien à payer ».

---

## 3. Hypothèses du rapprochement facture ↔ virement

`app/agents/rapport_fiscal/rapprochement.py`

| Hypothèse | Valeur | Pourquoi |
|---|---|---|
| Tolérance d'écart de montant | `0,02 €` | absorbe les arrondis ; au-delà, l'écart est **signalé**, pas absorbé |
| Fenêtre entre émission et encaissement | `120 jours` | au-delà, une coïncidence de montant ne prouve plus rien |
| Format de numéro reconnu | `FA-AAAA-NNNNNN`, `AV-AAAA-NNNNNN` | celui produit par l'agent de facturation (`data/facturation.yaml`) |

**Deux stratégies, dans cet ordre :**

1. **Numéro de facture** trouvé dans le motif ou la référence → rattachement **certain**. C'est
   exactement pourquoi le PDF de facture demande au client d'indiquer la référence.
2. **Montant et fenêtre de dates** concordants, et **un seul** candidat → rattachement
   **à confirmer**. Il est compté dans le CA mais isolé dans `ca_encaisse_certain`, et une alerte
   le rappelle. Deux factures du même montant ne sont jamais départagées : le virement part dans
   les non-retenus avec son motif.

**Décisions notables, toutes délibérées :**

- **Seuls les virements `direction == "recu"` entrent dans le CA.** Un sens indéterminé ou
  « émis » est écarté et soumis à confirmation. Inclure un virement sortant gonflerait à la fois
  l'impôt et les cotisations : le silence coûterait plus cher que la question.
- **Un virement hors période est ignoré sans bruit** — ni compté, ni signalé. Il appartient à une
  autre période, ce n'est pas une anomalie.
- **Un virement excédant le montant dû n'est affecté qu'à hauteur du dû.** Le surplus n'entre pas
  dans le CA et remonte en écart `excedent`. Le compter reviendrait à déclarer un chiffre
  d'affaires sans justificatif.
- **Les factures ne sont pas filtrées sur la période, seuls les virements le sont.** Un
  encaissement de janvier peut solder une facture de décembre : c'est le cas normal, pas
  l'exception.
- **Un avoir (`net_a_payer` négatif) ne réclame aucun encaissement** et n'apparaît pas dans les
  impayés.
- **Le chiffre d'affaires est le HT, pas le TTC encaissé.** Le client règle un montant TTC, mais
  la TVA collectée n'a jamais été un revenu : elle transite. Chaque encaissement porte donc deux
  montants — `montant` (ce que montre le relevé bancaire) et `montant_ht` (ce qui constitue le
  CA). La conversion utilise le rapport `total_ht / total_ttc` **de la facture elle-même** :
  aucun taux n'est supposé. En franchise en base les deux montants coïncident, ce qui rend
  l'erreur invisible — d'où un test explicite sur une facture assujettie.

Le suivi du reste dû, lui, se fait en **TTC** : c'est bien le TTC que le client doit encore
verser.

---

## 4. Ventilation par catégorie (activité mixte)

La nature d'une facture est celle **dominante** de ses lignes (`categorie: vente` contre le
reste, comparé en montant HT). Vente et prestation ne partagent ni abattement ni taux de
cotisations : les agréger serait faux, et le moteur reçoit donc une entrée par catégorie.

La correspondance vers les catégories du moteur :

| Nature de ligne | Catégorie fiscale |
|---|---|
| `vente` | `BIC_VENTE` |
| `prestation` | `contexte.categorie_par_defaut` (`BNC` par défaut, ou `BIC_SERVICE`) |

**Point de vigilance :** une prestation ne peut pas être qualifiée `BNC` ou `BIC_SERVICE` depuis
la seule facture — cela dépend de la nature de l'activité, pas de la ligne. C'est l'utilisateur
qui tranche via « Nature de l'activité ». Une mauvaise réponse change le taux de cotisations.

---

## 5. TVA — drapeau seul, aucun calcul

`app/agents/rapport_fiscal/tva.py`

Les seuils viennent de `data/seuils.yaml`, bloc `tva_franchise`. Aucun seuil n'est écrit dans le
code. Deux effets très différents, et c'est toute la raison du module :

- **seuil de base franchi** → assujettissement au **1er janvier de l'année suivante** ;
- **seuil majoré franchi** → assujettissement **dès le 1er jour du mois de dépassement**, donc
  rétroactivement sur des factures déjà émises sans TVA.

**Hypothèse :** les seuils s'apprécient sur l'**année civile entière**. Quand la période demandée
ne couvre pas l'année complète, l'alerte le dit et invite à confirmer sur l'année pleine.

---

## 6. Points à vérifier en direct

Rien de ce qui suit n'est un défaut de l'agent : ce sont des valeurs ou des règles qui doivent
être recoupées avec la source officielle avant tout usage déclaratif.

### 6.1 Valeurs marquées non vérifiées dans les données

| Où | Quoi | État |
|---|---|---|
| `data/impot_revenu.yaml` | `verifie: false` sur le fichier entier | **non recoupé** avec la source officielle. Le rapport le dit dans « Provenance », à l'écran comme en PDF. |
| `data/impot_revenu.yaml` | taux de CFP par catégorie | valeurs `0,1 %` / `0,3 %` / `0,2 %` à confirmer |
| `data/seuils.yaml` | plafonds micro, taux URSSAF, seuils TVA | `date_verif: 2026-07-23` — à recontrôler à chaque loi de finances |
| `data/seuils.yaml` | `versement_liberatoire.rfr_max_par_part` | RFR N-2 par part pour une option en 2026 |

### 6.2 Approximations connues du moteur, répercutées telles quelles

- **ACRE** : l'allègement est appliqué au taux global de cotisations. En toute rigueur la CSG-CRDS
  reste due — l'estimation est donc **légèrement favorable**. Une alerte le dit à chaque rapport
  où l'ACRE est active.
- **Décote « couple »** : donnée comme approximative par la source, à recouper avant usage
  déclaratif.
- **Barème, quotient familial, plafonnement, décote** : non encore recoupés avec la source
  officielle (conséquence de `verifie: false` ci-dessus).

### 6.3 Cas non couverts par la table de référence

| Cas | Comportement de l'agent |
|---|---|
| **DOM** | Les taux minorés outre-mer et la réfaction d'impôt ne figurent nulle part dans `data/`. Cocher « Activité exercée dans un DOM » déclenche une alerte **critique** disant que les montants sont calculés aux taux métropolitains et **surestiment** les cotisations. L'agent ne fabrique pas de taux qu'il n'a pas. |
| **Sortie du régime micro** | Elle suppose un dépassement sur **deux années consécutives**. L'agent ne voit qu'une période : il signale le dépassement en alerte critique et refuse explicitement de conclure. |
| **IR au barème sans le foyer** | Sans `parts_fiscales` **et** `autres_revenus`, `ir_bareme` reste `null` et `ir_bareme_calculable` vaut `false`. C'est un refus délibéré, pas une panne. Cotisations et base imposable restent calculées. |
| **Versement libératoire sans RFR N-2** | `eligible: null`. La comparaison barème / versement libératoire ne conclut pas, et le dit. |
| **CIPAV** | Le taux existe (`data/seuils.yaml`, `micro_social.bnc_cipav`) et est appliqué si l'utilisateur le déclare. La plateforme **ne devine pas** l'affiliation. |
| **Durée d'ACRE** | Hypothèse assumée : l'exonération couvre les `trimestres_civils` premiers trimestres **civils** à compter de celui du début. C'est la lecture courante de la règle URSSAF ; le rapport l'affiche comme hypothèse, pas comme certitude. Sans date de début, la durée restante n'est pas calculée — et le rapport le dit plutôt que d'inventer une fin. |

---

## 7. Où regarder dans le code

```
backend/app/agents/rapport_fiscal/
    schemas.py          contrats d'entrée et de sortie
    rapprochement.py    facture ↔ virement : QUOI a été encaissé, et sur quelle preuve
    sources.py          collecte des contrats et des dépenses capturés
    acre.py             statut ACRE : réduction, trimestres restants (calendrier, pas fiscal)
    contexte_profil.py  préremplissage du contexte depuis le profil d'onboarding
    tva.py              franchise en base : drapeau seul
    orchestrateur.py    assemble le payload, APPELLE le moteur, ne recalcule rien
    store.py            archivage des rapports (une photo, pas un recalcul)
    pdf.py              rendu, sans aucun calcul
backend/app/api/rapport_fiscal.py       GET /contexte · POST · GET (liste) · GET/{id} · /{id}/pdf · DELETE
frontend/src/lib/rapport-fiscal-api.ts  types + appels
frontend/src/components/lm/RapportFiscal.tsx   onglet « Rapport » de /activite
```

**Attention à l'ordre des routes** : `/contexte` doit rester déclaré AVANT `/{rapport_id}`,
sinon FastAPI le lit comme un identifiant et le préremplissage répond « rapport introuvable ».
Un test le verrouille.

**Tests** — 146 au total :

```
backend/tests/test_rapport_fiscal.py                    rapprochement, unitaire (30)
backend/tests/test_rapport_fiscal_cas_limites.py        cas limites, moteur réel (28)
backend/tests/test_rapport_fiscal_pdf.py                rendu PDF, surtout dégradé (14)
backend/tests/test_rapport_fiscal_integration.py        vraies factures + vrais virements (11)
backend/tests/test_rapport_fiscal_sources.py            prefill, contrats, dépenses, archivage (30)
backend/tests/test_rapport_fiscal_conformite_moteur.py  conformité à la spécification (33)
```

Les trois premières suites remplacent les sources de données par des doubles ; la dernière ne
remplace que MongoDB. Un renommage de champ chez l'agent de facturation ou l'agent capture doit
casser dans `..._integration.py`, et nulle part ailleurs.

---

## 8. Ce qu'il reste à faire

- **Rattachement manuel.** `MethodeRapprochement` prévoit déjà `"manuel"`, mais aucun endpoint ne
  permet encore à l'utilisateur de rattacher un virement à une facture. Aujourd'hui il constate
  l'anomalie sans pouvoir la corriger depuis l'écran.
- **Le CA encaissé ne voit que les virements.** Espèces, chèques et paiements par carte ne sont
  pas capturés : un utilisateur encaissant autrement qu'en virement verra un CA sous-estimé, sans
  que l'agent puisse le détecter. L'onboarding collecte désormais `accepted_payment_methods` et
  `manual_income_declaration_mode` — reste à s'en servir pour une saisie manuelle des recettes
  hors virement.
- **Les contrats ne sont pas rapprochés des factures.** On sait qu'un contrat de 24 000 € court
  sur la période, mais pas quelle part a été facturée. Rapprocher les deux permettrait de
  signaler du revenu engagé jamais facturé.

## 9. Archivage des rapports

Chaque rapport est **enregistré** au moment de sa génération (`rapports_fiscaux`), et son PDF est
rendu depuis l'archive — pas recalculé. C'est délibéré : un rapport est une photo de la période.
Retélécharger un rapport de mars après avoir corrigé une facture d'avril doit rendre les chiffres
de mars, pas ceux d'aujourd'hui. Générer un nouveau rapport sur la même période crée une nouvelle
entrée plutôt que d'écraser l'ancienne.
