# Veille fiscale personnalisée — ce que l'agent garantit, et ce qu'il ne garantit pas

## En une phrase

Un cycle planifié collecte l'actualité fiscale française, un LLM la qualifie **une seule fois** en
critères structurés, puis chaque utilisateur est confronté à ce catalogue par des règles
déterministes — sans appel LLM à la lecture.

## Architecture

```
COLLECTE  ──►  QUALIFICATION  ──►  catalogue     ──►  DISTRIBUTION  ──►  fil / notifications
(MCP)          (LLM, 1×)           (MongoDB)          (déterministe)
```

| Module | Rôle |
|---|---|
| `app/veille/modele.py` | Types, vocabulaire fermé des critères, clé de déduplication |
| `app/veille/store.py` | Trois collections Mongo + index |
| `app/veille/profil.py` | Profil de matching, fusion branche A (intake) + branche B (guidance) |
| `app/veille/scoring.py` | Verdict de pertinence, sans LLM |
| `app/veille/agent.py` | Cycle complet et distribution |
| `app/api/veille.py` | `/api/veille/*` |

### Collections

- `veille_nouveautes` — catalogue partagé, dédupliqué. Index unique sur `id`.
- `veille_notifications` — qui a vu quoi. Index **unique sur (uid, nouveaute_id)** : c'est ce qui
  garantit techniquement qu'une nouveauté n'est jamais renotifiée.
- `veille_preferences` — veille active, mode `tout` / `obligatoire_seulement`.

## Ce qui est garanti

**Aucun chiffre non sourcé.** Une nouveauté sans URL, ou adossée à la seule presse (autorité 3),
n'est pas publiée. Vérifié par test.

**Pas de renotification.** L'index unique le rend impossible, pas seulement improbable.

**Reproductibilité.** Le même profil et le même catalogue donnent toujours le même fil. Aucun LLM
sur le chemin de lecture : ni latence, ni coût, ni variation d'un chargement à l'autre.

**Les obligations passent devant.** Sous le plafond de 20 notifications par semaine, le tri place
`action_obligatoire` avant `action_recommandee`, puis `information`.

**Le plafond ne fait rien disparaître.** Au-delà de 20, les nouveautés restent consultables dans
l'onglet Veille ; seule la notification est retenue.

**Un profil vide ne reçoit que l'universel.** Sans champ discriminant, on ne notifie que les
mesures qui ne restreignent leur application à personne (`est_universelle`). Se taire complètement
priverait l'utilisateur de l'information la plus utile qu'on ait à lui donner — une obligation qui
s'impose à tous — mais lui envoyer des mesures ciblées reviendrait à diffuser une lettre
d'information générique.

**La distribution a lieu à CHAQUE lecture**, aussi bien sur le fil que sur `/notifications`. C'est
ce qui permet à un compte créé après la collecte de recevoir ses notifications. Elle est
déterministe et sans réseau : quelques requêtes Mongo, aucun appel LLM.

**Rien n'est supprimé.** Au-delà de 180 jours, une nouveauté est marquée `perime`. Elle sort du fil
et du décompte — la laisser visible faisait paraître l'écran figé, et la laisser dans le compteur
donnait une pastille impossible à éteindre — mais elle reste en base, consultable via
`nouveautes_actives(inclure_perimees=True)`.

**Le compteur compte ce que l'écran montre.** Une nouveauté périmée ou dont l'échéance est passée
est exclue des deux à la fois. Toute divergence entre les deux produit une pastille qu'aucun geste
de l'utilisateur ne peut éteindre.

## Ce qui n'est PAS garanti

**L'exhaustivité.** L'agent ne voit que ce que les serveurs MCP configurés lui remontent. Une
mesure publiée sur une source non branchée n'existe pas pour lui. **Ce n'est pas un substitut à
un suivi professionnel.**

**La déduplication parfaite.** La clé combine radicaux tronqués à 6 caractères et échéance. Elle
rapproche les reformulations proches ; deux titres franchement différents sur la même mesure
resteront séparés. Le risque est assumé dans ce sens : afficher deux fois vaut mieux qu'écraser à
tort une entrée mieux sourcée.

**L'exactitude du résumé.** Le résumé est produit par un LLM. Le prompt lui interdit d'inventer un
chiffre, mais rien ne le garantit formellement. **L'URL de la source est affichée précisément pour
que l'utilisateur puisse vérifier.**

**La justesse du rattachement.** Les critères sont extraits par LLM. Une extraction trop large fait
remonter une nouveauté sans intérêt ; trop étroite, elle en cache une pertinente. Le scoring est
volontairement prudent : un champ inconnu du profil n'exclut jamais.

**La détection des abrogations.** L'agent voit ce qui paraît, pas ce qui cesse de s'appliquer. Une
mesure abrogée reste au catalogue jusqu'à péremption par ancienneté.

**Le classement `impact`.** `action_obligatoire` vs `action_recommandee` relève du jugement du LLM.
À traiter comme une indication, pas comme une qualification juridique.

## Ce que la migration a changé

`GET /api/echeancier/veille` est **supprimé**. Il présentait quatre limites :

1. **Rien n'était persisté** — lecture d'un état en mémoire, perdu à chaque redémarrage
2. **Filtrage grossier** — trois étiquettes d'activité, sans regard sur le régime, le CA ou la TVA
3. **Réservé à la branche A** — 409 sans SIREN vérifié, excluant ceux qui ne sont pas encore
   immatriculés — précisément ceux qui ont le plus besoin de savoir qu'une règle change
4. **Modèle pauvre** — ni échéance, ni autorité de source, ni justification du rattachement

`/api/guidance/veille/*` est **conservé** : malgré le nom, c'est le rafraîchissement du corpus RAG
derrière l'agent pédagogue. Sujet différent, coexistence volontaire.

## Exploitation

```bash
VEILLE_ENABLED=true   # défaut
VEILLE_CRON_HOUR=6
```

Le planificateur enchaîne le cycle historique (corpus RAG + contrôle des seuils) puis le cycle
personnalisé. `POST /api/veille/run` déclenche un cycle à la main, pour diagnostic.

**Amorçage paresseux.** Le planificateur ne passe qu'une fois par jour, à heure fixe. Un serveur
redémarré dans la journée — le cas normal en développement — ne collectait donc jamais, et le
catalogue restait figé sur ce qu'un lancement manuel avait produit : la veille paraissait
statique et identique d'un compte à l'autre. À la première lecture, si le catalogue est vide ou
vieux de plus de `DELAI_RAFRAICHISSEMENT_H` (12 h), une collecte part en tâche de fond. Deux
garde-fous : un verrou de processus contre les cycles concurrents, et la mémoire de la dernière
**tentative** — sans elle, un MCP indisponible ferait relancer une collecte à chaque sondage de la
cloche, toutes les cinq minutes.

## Points ouverts

- **Le seuil de 180 jours** avant péremption est arbitraire. À caler sur l'usage réel.
- **Les seuils de score** (`SEUIL_AFFICHAGE=1.0`, `SEUIL_NOTIFICATION=3.0`) et les poids par
  critère n'ont pas été calibrés sur des données réelles — seulement sur des cas de test.
- **Aucun canal de notification externe.** Tout est en base ; il n'y a ni email, ni push. Le
  frontend lit `/api/veille/notifications`.
- **Le cycle n'a jamais tourné en conditions réelles** : les serveurs MCP n'étaient pas joignables
  pendant le développement. La collecte est testée par substitution, pas de bout en bout.
