# Travailler à plusieurs sur ce dépôt

Quatre équipes poussent dans le même dépôt. Ce document décrit le minimum qui évite deux
accidents distincts : les **conflits Git** (mécaniques, faciles à résoudre) et les
**écrasements de fonctionnalités** (silencieux, coûteux — Git ne les signale pas).

## 1. Personne ne pousse sur `main`

```bash
git checkout main && git pull          # partir du dernier état commun
git checkout -b mon-sujet              # une branche par sujet
# ... travail, commits ...
git push -u origin mon-sujet           # jamais rejeté : personne d'autre n'y touche
```

Puis une pull request. `main` n'est modifiée que par des merges relus.

## 2. Se resynchroniser avant de proposer sa PR

```bash
git fetch origin
git rebase origin/main                 # rejoue MES commits par-dessus le travail des autres
```

En cas de conflit, Git s'arrête et liste les fichiers concernés :

```bash
git status
# éditer : choisir quoi garder entre <<<<<<< et >>>>>>>
git add <fichier>
git rebase --continue
git push --force-with-lease            # après un rebase — JAMAIS --force tout court
```

`--force-with-lease` refuse d'écraser si quelqu'un a poussé sur la branche entre-temps.
C'est toute la différence entre « je republie mon travail » et « j'efface celui d'un collègue ».

`git merge origin/main` est une alternative acceptable (pas de `--force`, mais un historique
avec des commits de merge).

## 3. Fichiers partagés : les points de friction connus

| Fichier | Pourquoi ça frotte | Comment faire |
|---|---|---|
| `backend/app/main.py` | chacun ajoute son `include_router` | conflit trivial : garder **les deux** lignes |
| `backend/app/config.py` | chacun ajoute ses réglages | idem, garder les deux blocs |
| `requirements.txt` | chacun ajoute ses dépendances | garder les deux, vérifier qu'aucune version ne se contredit |
| `frontend/src/lib/api.ts` | client d'API commun | préférer un fichier par domaine (`guidance-api.ts`) |
| `frontend/src/routeTree.gen.ts` | **généré** par le build | ne pas résoudre à la main : prendre une version, relancer `npm run build` |
| `frontend/package-lock.json` | généré par `npm install` | idem, régénérer plutôt que fusionner |

Règle générale : **un dossier par agent**, et le code partagé reste mince. Deux personnes qui
travaillent dans des dossiers différents ne se conflicteront jamais.

## 4. Le risque principal n'est pas le conflit Git

Un conflit est bruyant : Git s'arrête et demande un arbitrage. Le vrai danger est **silencieux** —
une intégration qui réécrit ou supprime le module d'une autre équipe passe sans aucune alerte,
parce que pour Git, supprimer un dossier est une modification comme une autre.

Deux garde-fous :

1. **`.github/CODEOWNERS`** — GitHub demande automatiquement la relecture du propriétaire d'un
   dossier dès qu'une PR y touche. Une intégration qui réécrit le code d'un agent ne peut plus
   être fusionnée sans que son auteur l'ait vue.
2. **Intégrer, c'est brancher, pas réécrire.** Quand une fonctionnalité doit s'adapter à
   l'infrastructure commune (base de données, authentification, client LLM), on remplace la
   **couche d'infrastructure** et on garde la logique métier. Si une intégration supprime des
   règles métier (une question, une vérification, un garde-fou de prompt), c'est une décision
   produit : elle se discute dans la PR, elle ne se fait pas en passant.

## 5. Avant d'ouvrir une PR

```bash
# Backend
pytest backend/tests -q

# Front
cd frontend && npx tsc --noEmit && npm run build
```

Décrire dans la PR **ce qui change pour les autres équipes** : nouvel endpoint, nouvelle
variable d'environnement, nouvelle dépendance, nouvelle collection MongoDB.
