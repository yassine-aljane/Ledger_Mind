# Facturation — valeurs réglementaires à vérifier en direct

> À l'attention d'un humain qui doit brancher une source live ou réviser après une loi de
> finances. Aucune de ces valeurs n'est codée en dur dans la logique : toutes vivent dans
> `data/`, avec leur source et leur date de contrôle.

---

## 1. Où vivent les valeurs

| Fichier | Contenu |
|---|---|
| [`data/facturation.yaml`](../data/facturation.yaml) | Mentions obligatoires, indemnité de recouvrement, seuil de dispense TVA intracom, délais de paiement, numérotation |
| [`data/seuils.yaml`](../data/seuils.yaml) | **Seuils de franchise en base de TVA** — fichier préexistant, non dupliqué |

Le code y accède **uniquement** par
[`app/agents/facture/reglementaire.py`](../backend/app/agents/facture/reglementaire.py).
Une valeur absente lève `MentionManquante` plutôt que de retomber sur un défaut silencieux :
une mention légale inventée est pire qu'une facture refusée.

---

## 2. Les valeurs marquées `verifier_en_direct: true`

Ces quatre blocs portent un drapeau explicite dans le YAML. `reglementaire.provenance()` les
liste à l'exécution — c'est ce que remonte l'endpoint `GET /api/facture/alerte-tva`.

### 2.1 Indemnité forfaitaire de recouvrement — **40 €**

```yaml
indemnite_recouvrement:
  montant: 40
  due_aux_particuliers: false
```

- **Base légale** : art. L441-10 et D441-5 du code de commerce
- **Pourquoi la surveiller** : le montant est fixé par **décret**, révisable sans loi de finances
- **Où brancher** : service-public.fr fiche F31808, ou Légifrance sur l'article D441-5
- ⚠️ **Règle métier associée** : cette indemnité n'est due **qu'entre professionnels**.
  La mentionner sur une facture adressée à un particulier serait une mention abusive.
  Le drapeau `due_aux_particuliers: false` pilote ce comportement.

### 2.2 Seuil de dispense du n° de TVA intracommunautaire — **150 € HT**

```yaml
tva_intracommunautaire:
  seuil_dispense_ht: 150
```

- **Source** : fiche F31808 — « Sauf pour les factures d'un montant total HT inférieur ou égal à 150 € »
- **Effet** : au-delà, le n° de TVA intracommunautaire du vendeur devient obligatoire sur la facture

### 2.3 Pénalités de retard — **taux légal en vigueur**

```yaml
penalites_retard:
  mention: "Taux légal en vigueur, exigibles sans rappel nécessaire"
```

- **Pourquoi la mention reste générique** : le taux est révisé **chaque semestre**. Afficher un
  taux chiffré garantirait qu'il soit périmé six mois plus tard.
- **Si vous voulez chiffrer** : brancher la publication semestrielle de la Banque de France, et
  n'afficher le taux que daté.

### 2.4 Délais de paiement — **30 jours par défaut, 60 maximum**

```yaml
paiement:
  delai_defaut_jours: 30
  delai_maximum_jours: 60
```

- **Base légale** : art. L441-10 du code de commerce (plafond de 60 jours date de facture, ou
  45 jours fin de mois)
- Le défaut de 30 jours est un **choix produit**, en deçà du plafond légal.

---

## 3. Seuils de franchise en base de TVA

Ils vivent dans [`data/seuils.yaml`](../data/seuils.yaml), bloc `tva_franchise` — vérifié au
2026-07-23 :

| Activité | Seuil de base | Seuil majoré |
|---|---|---|
| Prestations de services | 37 500 € | 41 250 € |
| Vente de marchandises | 85 000 € | 93 500 € |

Le fichier note que la réforme du seuil unique à 25 000 € a été **abandonnée / suspendue**.

> ⚠️ **Le système ne bascule jamais seul.** Le seuil porte sur le CA **encaissé**, que la
> plateforme ne connaît pas de façon fiable — une facture émise n'est pas une facture payée.
> `alerte_seuil_tva()` **signale** l'approche ou le dépassement sur le CA **facturé** ; le
> régime reste **déclaré par l'utilisateur** (`franchise_tva(profil, assujetti_declare=…)`).
>
> Basculer automatiquement exposerait l'utilisateur à facturer sans TVA alors qu'il la doit,
> ou l'inverse — deux erreurs coûteuses.

---

## 4. Ce qui n'est pas une valeur réglementaire

Le **format de numérotation** (`FA-2026-000042`, `AV-2026-000042`) est un choix produit, pas une
obligation. Ce qui est légalement imposé (art. 242 nonies A annexe II CGI) est la **continuité
sans trou ni doublon** — d'où :

- deux séquences distinctes, chacune continue ;
- un compteur atomique côté MongoDB (`find_one_and_update` + `$inc`) ;
- **aucun numéro consommé par un brouillon** — c'est ce qui garantit qu'une création
  abandonnée ne laisse pas de trou ;
- l'année ne remet pas le compteur à zéro : la continuité prime sur l'esthétique.

---

## 5. Procédure de révision

1. Modifier la valeur dans le YAML concerné.
2. Mettre à jour `date_verif` du bloc **et** de l'en-tête du fichier.
3. Lancer `pytest backend/tests/test_facture.py backend/tests/test_facture_cycle_vie.py -q`.
   Les tests vérifient que les valeurs proviennent bien des fichiers, pas du code.
4. Aucun redéploiement de code n'est nécessaire : le chargement est mis en cache par processus,
   `reglementaire.reload()` le vide à chaud.
