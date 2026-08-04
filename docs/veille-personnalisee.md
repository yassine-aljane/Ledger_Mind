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

**Un profil vide ne notifie rien.** Sans champ discriminant, envoyer des notifications reviendrait
à diffuser une lettre d'information générique.

**Rien n'est supprimé.** Au-delà de 180 jours, une nouveauté est marquée `perime` et affichée avec
un avertissement — jamais retirée.

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

La veille reste **désactivée par défaut** (`VEILLE_ENABLED=false`) : elle sort sur le réseau et
appelle le LLM. Pour l'activer :

```bash
VEILLE_ENABLED=true
VEILLE_CRON_HOUR=6
```

Le planificateur enchaîne alors le cycle historique (corpus RAG + contrôle des seuils) puis le
cycle personnalisé. `POST /api/veille/run` déclenche un cycle à la main, pour diagnostic.

## Points ouverts

- **Le seuil de 180 jours** avant péremption est arbitraire. À caler sur l'usage réel.
- **Les seuils de score** (`SEUIL_AFFICHAGE=1.0`, `SEUIL_NOTIFICATION=3.0`) et les poids par
  critère n'ont pas été calibrés sur des données réelles — seulement sur des cas de test.
- **Aucun canal de notification externe.** Tout est en base ; il n'y a ni email, ni push. Le
  frontend lit `/api/veille/notifications`.
- **Le cycle n'a jamais tourné en conditions réelles** : les serveurs MCP n'étaient pas joignables
  pendant le développement. La collecte est testée par substitution, pas de bout en bout.
