# Agent déclaratif — les cinq obligations, préparées jamais transmises

Ce document accompagne `backend/app/agents/declarations`. Il répond à deux questions : **ce que
l'agent décide de lui-même**, et **ce qu'il refuse de faire, et pourquoi**.

---

## 1. Les quatre interdits

Ils viennent de la spécification, et les enfreindre produirait une déclaration fausse sans que
rien ne le signale.

| Interdit | Ce qu'il évite |
|---|---|
| **Ne jamais déduire l'abattement** avant de remplir une case | Les cases 5KO / 5KP / 5HQ attendent le **CA BRUT** ; l'administration applique l'abattement. Le déduire ici le compterait **deux fois**. |
| **Ne jamais inventer un numéro de case** | Les références du CA3 ne sont pas recoupées : ses champs sortent marqués `a_verifier`, sans numéro. |
| **Ne jamais fusionner les lignes de CA** | Trois natures (vente, BIC services, BNC), trois taux. Les additionner appliquerait un seul taux à des assiettes différentes. |
| **Ne jamais taire une déclaration à 0 €** | Celle du CA URSSAF reste due. L'omettre coûte une pénalité alors qu'aucune somme n'est due. |

Deux règles s'y ajoutent, structurelles :

- **L'agent ne calcule aucun montant.** Tout vient de `app.agents.impots`. Un second calcul
  divergerait tôt ou tard du premier.
- **Aucun endpoint ne transmet.** Il n'en existe pas, et un test le vérifie. La validation et
  l'envoi restent des gestes humains.

---

## 2. L'assiette et les sources

Le **CA ENCAISSÉ**, obtenu par le rapprochement facture ↔ virement déjà en place
(`app.agents.rapport_fiscal.rapprochement`). Une facture émise et non payée ne se déclare pas :
elle se déclarera lors de son encaissement.

Six sources, chacune avec un rôle distinct :

| Source | Alimente | Entre dans une case ? |
|---|---|---|
| Factures **émises** | CA encaissé (via rapprochement) + **TVA collectée** | oui |
| **Cadeaux reçus** | avantages en nature, à leur valeur marchande | **oui**, sans flux bancaire |
| Factures **reçues** (capture) | **TVA déductible** | oui, sur le CA3 |
| Virements | encaissements + détection des revenus UE | oui |
| Contrats | cohérence : prestation exécutée non facturée ? | **jamais** |
| Profil d'onboarding | périodicité, catégorie, régime TVA, commune, département | non (paramètres) |
| Rapports fiscaux archivés | **recoupement** de l'assiette déjà établie | non |

**Le recoupement compte.** Si un rapport porte exactement la même période avec un autre CA, un
rappel de priorité haute le signale : une pièce a bougé entre les deux, et déclarer sans le
savoir rend le montant injustifiable.

## 2 bis. La TVA (CA3), désormais chiffrée

| Poste | Source | Réserve |
|---|---|---|
| **Collectée** | `total_tva` des factures émises de la période | La TVA des prestations est exigible à l'**encaissement** ; la base retient les factures **émises** — écart signalé. |
| **Déductible** | `vat_amount` des factures d'achat capturées | Seuls les achats **professionnels** ouvrent droit à déduction. L'agent additionne ce qu'il voit et le dit. |
| **Nette** | collectée − déductible | Négative = crédit de TVA, signalé comme tel. |

Deux refus explicites :

- **Le taux n'est jamais supposé.** On lit la TVA réelle de chaque facture, pas 20 % appliqués à
  tout : une facture peut porter 20 %, 10 % ou 5,5 %, et une facture en franchise n'en porte pas.
- **Une TVA illisible n'est pas une TVA nulle.** Les pièces dont le montant n'a pas été lu sont
  comptées à part et signalées, jamais additionnées comme des zéros.

Les **numéros de case** du CA3 restent inconnus : les montants sont sûrs, les références ne le
sont pas. Chaque ligne sort donc marquée `a_verifier`.

---

## 3. Les cinq déclarations

| # | Déclaration | Formulaire | Fréquence | Montant |
|---|---|---|---|---|
| 1 | Chiffre d'affaires URSSAF | téléservice | déclarée par l'utilisateur | cotisations + CFP + TFCC (+ VL) |
| 2 | Revenus annuels | **2042-C-PRO** (CERFA 11222) | annuelle | — |
| 3 | DES | téléservice Prodouane | mensuelle | **aucun** — informative |
| 4 | TVA | **3310-CA3** | selon régime | à établir hors plateforme |
| 5 | CFE | 1447-C-SD (une seule fois) | annuelle | **non calculable** |

### Ce qui déclenche chacune

- **URSSAF** — toujours, dès l'inscription, même à 0 €.
- **2042-C-PRO** — toujours, une fois par an, y compris sous versement libératoire (le CA y est
  reporté à titre informatif).
- **DES** — un encaissement provenant d'une entité établie dans l'UE. **Même sous franchise de
  TVA nationale** : les deux régimes sont indépendants, et rien dans le suivi du CA ne l'annonce.
- **TVA** — uniquement si le régime déclaré est `reel_simplifie` ou `reel_normal`. La plateforme
  ne bascule jamais seule un régime de TVA.
- **CFE** — dès la 2ᵉ année. Exonération d'office la première.

---

## 4. Détection des revenus européens

`revenus_ue.py`. Deux signaux, de fiabilité très inégale :

| Signal | Fiabilité | Marqué |
|---|---|---|
| **IBAN émetteur** hors France, dans l'UE | donnée structurée | `certain: true` |
| **Libellé** correspondant à une plateforme connue | indice, pas preuve | `certain: false` |

« Google » dans un motif ne prouve pas que le payeur est établi en Irlande. Un rattachement par
libellé est donc soumis à confirmation, et le champ correspondant du brouillon sort en
`a_verifier`.

Seuls les virements **reçus** sont examinés : la DES porte sur les services que l'utilisateur
**fournit** à un preneur établi dans un autre État membre.

**Rappel prioritaire** : un revenu UE détecté sans numéro de TVA intracommunautaire déclenche une
alerte `haute`. La démarche est gratuite, et certaines plateformes ne peuvent pas activer le
paiement sans ce numéro — elle précède donc la perception.

---

## 5. Valeurs à vérifier en direct

Rien de ce qui suit n'est un défaut : ce sont des valeurs à recouper avec la source officielle
avant tout usage déclaratif. Toutes vivent dans `data/declarations.yaml` avec leur `source`, leur
`date_verif` et un drapeau `verifie`.

| Valeur | État | Conséquence |
|---|---|---|
| **Taux de TFCC** (~0,015 % / ~0,044 %) | `verifie: false` | Le brouillon URSSAF affiche un avertissement explicite. |
| **Seuil d'exonération de CFP** (5 000 €, 1ʳᵉ année) | `verifie: false` | À confirmer sur autoentrepreneur.urssaf.fr. |
| **Numéros de case du CA3** | **non confirmés** | Aucun numéro n'est affiché ; seule la structure l'est. |
| **Échéance de la 2042-C-PRO** | variable | Dépend du département **et** de l'année : jamais codée en dur, seulement rappelée. |
| **Montant de la CFE** | non calculable | Barème voté commune par commune. L'annoncer serait l'inventer. |

---

## 6. Où regarder dans le code

```
data/declarations.yaml                        cases officielles, TFCC, CFE, DES
backend/app/agents/impots/tools.py            calculer_prelevements_periode  ← LE calcul
backend/app/agents/declarations/
    schemas.py      contrats (Brouillon, ChampBrouillon, Rappel…)
    contexte.py     préremplissage depuis le profil d'onboarding
    revenus_ue.py   détection UE : IBAN d'abord, libellé ensuite
    generateur.py   assemble les cinq brouillons — aucune formule fiscale
    store.py        archivage (un jeu est une photo)
backend/app/api/declarations.py               GET /contexte · POST · GET · GET/{id} · DELETE
frontend/src/lib/declarations-api.ts          types + appels
frontend/src/components/lm/Declarations.tsx   onglet « Déclaration » de /activite
```

**Tests** — `backend/tests/test_declarations.py`, 42 tests, organisés autour des quatre interdits.
L'exemple chiffré de la spécification (§4, « Léa » : 1 100 € en BIC services, 2ᵉ année,
versement libératoire, AdSense irlandais) est reproduit **au centime** : 255,68 €.

---

## 7. Ce qu'il reste à faire

- **N° de TVA du preneur (DES).** Le formulaire l'exige, et il n'est pas détectable depuis un
  virement : il figure sur la facture du preneur. Le champ apparaît dans le brouillon, vide et
  marqué à compléter. Le collecter par client serait le prochain pas utile.
- **Commune pour la CFE.** Seul le département est déduit de l'adresse, alors que le barème est
  voté par la **commune**. Le champ est présent mais marqué à vérifier.
- **CA cumulé annuel.** Repris du profil quand il existe, sinon estimé sur la période demandée —
  ce qui fausse l'exonération de CFP si la période n'est pas l'année entière.
- **Exigibilité de la TVA à l'encaissement.** La TVA collectée s'appuie sur les factures
  **émises** de la période, alors que l'exigibilité suit l'**encaissement** pour les prestations.
  L'écart est signalé sur le document ; le rapprocher pièce à pièce reste à faire.
- **Jours fériés.** Le « 10ᵉ jour ouvrable » de la DES et les reports d'échéance ne tiennent
  compte que des week-ends : sans calendrier des jours fériés, ces dates restent des fenêtres.
