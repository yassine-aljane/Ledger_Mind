# RGPD, sécurité et confidentialité — ce qui est en place

> **Version :** 1.0 — 10 août 2026
> **Objet :** inventaire de tout ce qui a été ajouté au titre de la protection des données et de la sécurité des sessions : ce que ça fait, pourquoi ces choix, ce qui reste ouvert, et quoi mettre à jour quand le code bouge.

## Comment lire ce document

| Étiquette | Signification |
|---|---|
| **[Fait]** | Implémenté et vérifié dans le dépôt. |
| **[Manuel]** | Obligation satisfaite par un processus humain, sans outillage. Légal, mais ne passe pas à l'échelle. |
| **[À faire]** | Manque identifié, non couvert aujourd'hui. |
| **[À valider]** | Affirmation qui ne peut pas être vérifiée depuis le code — contrat, identité juridique, décision d'équipe. |

---

## 1. Vue d'ensemble

Trois pages publiques, un catalogue partagé, et une refonte du transport de session.

| Ajout | Chemin | Nature |
|---|---|---|
| Politique cookies | `/cookies` — [`frontend/src/routes/cookies.tsx`](../frontend/src/routes/cookies.tsx) | Document |
| Politique de confidentialité | `/confidentialite` — [`frontend/src/routes/confidentialite.tsx`](../frontend/src/routes/confidentialite.tsx) | Document |
| Mes données sur cet appareil | `/mes-donnees` — [`frontend/src/routes/mes-donnees.tsx`](../frontend/src/routes/mes-donnees.tsx) | Outil |
| Catalogue des traceurs | [`frontend/src/lib/traceurs.ts`](../frontend/src/lib/traceurs.ts) | Source de vérité |
| Session en cookie `httpOnly` | `backend/app/{config,main}.py`, `backend/app/api/{auth,deps}.py`, `frontend/src/lib/auth.ts` | Sécurité |

Les trois pages sont liées depuis le pied de page du site public ([`components/lm/Marketing.tsx`](../frontend/src/components/lm/Marketing.tsx)) et se renvoient l'une à l'autre.

---

## 2. Deux réglementations, deux périmètres

La confusion la plus fréquente sur ce sujet, et celle qui décide de ce qu'il faut construire :

| | Déclencheur | Ce que ça impose ici |
|---|---|---|
| **ePrivacy** (art. 82 loi Informatique et Libertés) | **Écrire ou lire sur l'appareil** du visiteur | Consentement préalable, **sauf** traceur strictement nécessaire au service demandé |
| **RGPD** | **Traiter des données personnelles**, où qu'elles soient | Information, base légale, durées, sous-traitants, sécurité, droits, transferts |

La sensibilité des données traitées (SIREN, KBIS, factures, contrats) **ne déclenche pas** l'obligation de bandeau cookies : elle relève entièrement de la colonne de droite. Inversement, un site sans aucune donnée personnelle serveur peut avoir besoin d'un bandeau s'il pose un traceur publicitaire.

C'est pourquoi l'effort a porté sur la politique de confidentialité et la sécurité des sessions, pas sur une fenêtre de consentement.

---

## 3. Politique cookies et catalogue des traceurs

### 3.1 Pourquoi aucune fenêtre de consentement **[Fait — choix documenté]**

Aucun traceur de LedgerMind ne relève du consentement : pas de mesure d'audience, pas de pixel publicitaire, pas de suivi inter-sites. Tout ce qui est écrit sur l'appareil sert à tenir la session, conserver le parcours en cours ou retenir une préférence d'affichage — donc strictement nécessaire au service demandé, donc exempté.

Afficher un bandeau serait ici **contre-productif** : la CNIL considère comme trompeur un consentement demandé pour un traceur que l'utilisateur ne peut pas refuser sans casser le service.

La page `/cookies` assume et explique ce choix plutôt que de le passer sous silence — c'est ce qui la rend défendable en cas de contrôle.

### 3.2 Le catalogue **[Fait]**

[`lib/traceurs.ts`](../frontend/src/lib/traceurs.ts) décrit les 13 traceurs réellement posés, en 3 groupes :

| Groupe | Contenu | Effaçable sans conséquence |
|---|---|---|
| Compte et session | **`ledgermind_session`** (cookie `httpOnly`), `ledgermind_access_token` (reliquat d'avant la bascule), `ledgermind_user`, `lm.plan.<identifiant>`, `lm.plan.pending` | non |
| Continuité du parcours | `lm.anon_id`, `ledgermind_guidance_session`, `ledgermind_session_id`, `ledgermind_diagnostic_result`, `ledgermind_scenarios_brouillon` | non |
| Confort d'affichage | `lm.theme`, `sidebar_state`, `lm.veille.nouveaux` | oui |

Chaque entrée porte : clé réelle, mode de correspondance (`exacte` ou `prefixe`), support (cookie / stockage local / stockage de session), finalité et durée.

**Le catalogue est partagé** entre `/cookies` (qui l'affiche comme inventaire réglementaire) et `/mes-donnees` (qui s'en sert pour inspecter et effacer). Deux listes séparées auraient dérivé — et une politique qui décrit des traceurs inexistants, ou qui en oublie, est aussi fautive qu'une politique absente.

### 3.3 Subtilité de correspondance

La formule est stockée par compte (`lm.plan.<identifiant>`), d'où le mode `prefixe`. Mais `lm.plan.pending` commence par le même préfixe tout en ayant une finalité et une durée distinctes : **les correspondances exactes priment sur les préfixes**, sinon `lm.plan.pending` disparaîtrait de l'inventaire. C'est testé (§7).

---

## 4. Écran « Mes données sur cet appareil »

**[Fait]** — `/mes-donnees` n'est **pas** une fenêtre de consentement, et il ne faut pas le transformer en cela : les traceurs listés ne sont pas optionnels. Ce qu'il offre est autre chose, et c'est réel :

- **Inventaire lu à l'exécution**, pas déclaré : ce sont les clés effectivement présentes qui s'affichent, avec leur poids.
- **Signalement des clés hors catalogue** — filet contre une documentation en retard sur le code. Si un développeur ajoute une clé sans mettre à jour `traceurs.ts`, elle apparaît sous « Autres éléments présents ».
- **Deux effacements** : les préférences d'affichage seules (la session survit), ou tout (avec confirmation).

L'effacement complet emporte aussi les clés non répertoriées : promettre « tout effacer » et laisser derrière soi ce qu'on n'avait pas prévu serait exactement le manquement à éviter.

### Le cas du cookie invisible

Le cookie de session est `httpOnly` : JavaScript ne peut ni le lire ni l'effacer. Trois conséquences, chacune traitée explicitement — c'est le point d'articulation entre §3 et §6, et celui qu'on oublie le plus facilement :

1. **Il figure quand même au catalogue** (`observable: false`). Un cookie non documenté est un manquement, qu'on puisse le lire ou non.
2. **`/mes-donnees` affiche « Non lisible depuis cette page »**, jamais « Absent » — afficher « Absent » laisserait croire qu'aucune session n'est ouverte.
3. **« Tout effacer » appelle `revoquerSession()`** en plus de `effacer("tout")`. Sans cet appel serveur, l'interface repasserait en visiteur pendant que la session resterait valide : une promesse de sécurité fausse. Si la révocation échoue (hors ligne), l'utilisateur est averti au lieu d'être faussement rassuré.

---

## 5. Politique de confidentialité

**[Fait]** — `/confidentialite`, 10 sections. Le contenu est piloté par des tableaux de données en tête de fichier (`CATEGORIES`, `DESTINATAIRES`, `SERVICES_PUBLICS`, `DUREES`) : modifier une durée ou ajouter un sous-traitant est une ligne à changer.

### 5.1 Ce qui la distingue d'un modèle générique

Chaque affirmation vérifiable a été tirée du code. Le tableau ci-dessous est **le contrat de maintenance** : si l'un de ces fichiers change, la page doit changer.

| Affirmation de la page | Ancrage dans le code |
|---|---|
| Conversations sans compte purgées à 30 jours | `_TTL_DAYS`, [`core/conversation_store.py`](../backend/app/core/conversation_store.py) |
| Jeton de connexion : 14 jours | `auth_token_days`, [`app/config.py`](../backend/app/config.py) |
| Suppression d'une pièce à tout moment | `delete_document`, [`api/capture.py`](../backend/app/api/capture.py) + `delete_original_file` |
| Mots de passe non réversibles | bcrypt, [`core/security.py`](../backend/app/core/security.py) |
| Session illisible par les scripts de la page | cookie `httpOnly`, [`api/auth.py`](../backend/app/api/auth.py) |
| Cloisonnement par compte | index unique incluant `user_id`, `agents/capture/app/db.py` |
| OCR SIRET sans envoi à un tiers | RapidOCR local, [`services/ocr_siret.py`](../backend/app/services/ocr_siret.py) |
| Justificatifs lus par un prestataire européen | `mistral-ocr-latest`, `mistral-large-latest`, `pixtral-12b-latest`, `agents/capture/app/config.py` |
| Périmètre exact de Gemini | [`llm/__init__.py`](../backend/app/llm/__init__.py), `agents/{intake,guidance}/understand.py`, `services/ocr_registry_doc.py` |

### 5.2 Cartographie des traitements

**Sous-traitants**

| Prestataire | Rôle | Données | Localisation |
|---|---|---|---|
| MongoDB Atlas | Base + pièces d'origine (GridFS) | Tout le dossier | **[À valider]** région à confirmer |
| Mistral AI | Assistant fiscal, guidance, veille, embeddings, OCR et extraction des justificatifs | Questions, contenu des documents | UE (France) |
| Google (Gemini) | Compréhension des réponses au questionnaire ; levée d'ambiguïté sur un document de registre | Réponses au diagnostic, texte OCR d'un KBIS/RNE ambigu | **Hors UE** |
| Pinecone | Index de la documentation produit | **Aucune donnée personnelle** | Hors UE (`aws / us-east-1`) |

**Point important, souvent mal compris en interne :** les factures, relevés et conversations avec l'assistant fiscal **ne passent pas** par Gemini. Le module capture est entièrement Mistral, et l'OCR des SIRET/avis SIRENE tourne en local. L'exposition hors UE est étroite et identifiée.

**Services publics interrogés** — registres INSEE/INPI/RNE (le SIREN saisi), Base Adresse Nationale + Nominatim + Overpass (la commune saisie pour situer une recherche d'expert-comptable), annuaire des experts-comptables. Légifrance/BOFiP/URSSAF/impots.gouv/BOSS alimentent le corpus sans aucune donnée utilisateur.

---

## 6. Sécurité des sessions — jeton en cookie `httpOnly`

### 6.1 Le problème traité **[Fait]**

Le jeton d'authentification vivait dans `localStorage`, donc lisible par **tout script s'exécutant dans la page**. Une injection de script suffisait à emporter la session — et avec elle l'accès aux justificatifs fiscaux du compte.

### 6.2 Ce qui a changé

| Élément | Avant | Après |
|---|---|---|
| Transport du jeton | `localStorage` + en-tête `Authorization` | Cookie `httpOnly`, posé par le serveur |
| Jeton dans la réponse JSON | oui (`access_token`) | **non** — l'exposer annulerait le bénéfice |
| Déconnexion | effacement local | endpoint `POST /api/auth/logout` (seul le serveur peut retirer un cookie `httpOnly`) |
| CORS | sans identifiants | `allow_credentials=True` + origines explicites |
| CSRF | sans objet | contrôle d'origine sur les écritures |
| `isAuthed()` côté client | présence du jeton | présence de l'identité mémorisée — **indice d'affichage, pas contrôle d'accès** |

Le serveur lit **le cookie d'abord, l'en-tête `Authorization` ensuite** ([`api/deps.py`](../backend/app/api/deps.py)). Le repli garde les scripts, tests et intégrations fonctionnels sans réintroduire le risque : hors navigateur, il n'y a pas de page où injecter quoi que ce soit.

Côté client, les **36 appels authentifiés** portent `...AVEC_SESSION` (`credentials: "include"`). Sans cette option, le navigateur n'attache pas le cookie sur un appel inter-origine — et le front et le back n'écoutent jamais sur le même port.

### 6.3 Le revers du cookie, et sa réponse

Un cookie est attaché **automatiquement** par le navigateur à chaque appel — y compris à un appel déclenché par un site malveillant. Le passage à `httpOnly` supprime le vol de jeton mais ouvre la porte à la requête forgée (CSRF).

`SameSite` est la première barrière, mais elle **disparaît** si le déploiement impose `samesite=none` (front et back sur des domaines différents). D'où le contrôle d'origine dans [`app/main.py`](../backend/app/main.py), qui tient dans les deux cas :

- appliqué aux seules méthodes d'écriture (`POST`, `PUT`, `PATCH`, `DELETE`) ;
- une requête **sans** en-tête `Origin` n'est pas bloquée — ce sont les appels hors navigateur, qui n'ont pas de session ambiante à détourner ;
- le navigateur interdit à une page de falsifier `Origin`, ce qui rend le contrôle fiable.

### 6.4 Réglages de déploiement — **le point qui peut casser la production**

| Variable | Développement | Production |
|---|---|---|
| `AUTH_COOKIE_SECURE` | `false` (HTTP local) | **`true`** — un cookie `Secure` n'est jamais posé en HTTP |
| `AUTH_COOKIE_SAMESITE` | `lax` | `lax` **si** front et back partagent le domaine (`app.` / `api.` du même nom, les ports ne comptent pas) ; **`none` sinon**, ce qui exige `secure=true` |
| `AUTH_COOKIE_DOMAIN` | vide | à renseigner uniquement pour partager le cookie entre sous-domaines |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | l'origine réelle — `allow_credentials` interdit le joker `*` |

**Si `samesite` reste à `lax` avec un front et un back sur des domaines distincts, le navigateur n'enverra jamais le cookie et toutes les routes protégées répondront 401.** C'est le seul réglage capable de casser la connexion en production.

### 6.5 Effet au déploiement

Les sessions en cours sont invalidées : chaque utilisateur se reconnecte une fois. `clearAuth()` nettoie au passage l'ancienne clé `ledgermind_access_token` restée dans le stockage local des navigateurs ouverts avant la bascule.

---

## 7. Tests

| Portée | Ce qui est couvert |
|---|---|
| Catalogue des traceurs (18 assertions) | Inventaire, regroupement des clés par compte, priorité exacte > préfixe, rattachement du cookie, signalement des clés hors catalogue, effacement « confort » préservant la session, effacement total y compris les clés inconnues |
| Cookie `httpOnly` invisible (8 assertions) | Le cookie figure au catalogue, marqué non observable ; il n'apparaît ni dans l'inventaire lu ni parmi les clés inconnues ; `effacer("tout")` **laisse la session serveur ouverte** — c'est ce qui rend l'appel à `revoquerSession()` obligatoire |
| Authentification par cookie (17 assertions) | Attributs `httponly`/`samesite`/`path`, absence du jeton dans le corps, `/me` par le seul cookie, préflight CORS avec origine explicite et `allow-credentials`, écriture d'origine étrangère refusée (403), lecture non bloquée, appel sans `Origin` accepté, cookie expiré à la déconnexion puis 401, en-tête Bearer toujours accepté |
| Suite backend existante | **741 tests passent** — identique à la base de référence prise avant la bascule |

---

## 8. Ce qui reste ouvert

### 8.1 Avant toute mise en ligne **[À valider]**

1. **Adresse de contact** — `privacy@ledgermind.fr` est un placeholder, constante `CONTACT` en tête des deux pages.
2. **Identité du responsable de traitement** — la section 1 de `/confidentialite` reste générique.
3. **Clauses contractuelles types pour les transferts hors UE** — la section 5 de `/confidentialite` affirme que les transferts vers Google et Pinecone sont encadrés au titre du chapitre V. **C'est la seule affirmation des deux pages qui peut être factuellement fausse**, et le code ne peut pas le dire : à vérifier côté contrats.
4. **Région d'hébergement MongoDB Atlas** — annoncée « précisée sur demande », donc à connaître.

### 8.2 Promesses tenues à la main **[Manuel]**

| Droit | État |
|---|---|
| Suppression du compte et de son contenu | **Aucun endpoint.** Honorer une demande signifie aujourd'hui ouvrir MongoDB et supprimer à la main dans plusieurs collections **plus GridFS**. Tenable à 50 utilisateurs, pas à 500. |
| Portabilité (art. 20) | **Aucun export.** Reconstitution manuelle. |

Le RGPD n'impose pas un bouton, il impose de **répondre** dans le délai d'un mois — ces deux points sont donc légalement satisfaisables en l'état, mais sans outillage.

### 8.3 Chantiers identifiés **[À faire]**

1. **Endpoint de suppression de compte** — purge de `users`, `sessions`, conversations, messages, roadmaps, profils, factures, rapports, jeux de déclaration, documents capture **et GridFS**. Transforme une promesse en fonction.
2. **Export du dossier** (JSON) — couvre la portabilité.
3. **Registre des traitements** (art. 30) et **DPA signés** avec chaque sous-traitant (art. 28).
4. **AIPD** (art. 35) — à instruire au vu du volume de données financières.
5. **Bascule Gemini → Mistral** — supprimerait le dernier transfert hors UE portant sur des données personnelles, et simplifierait d'autant la section 5 de la politique. Chantier proposé mais non retenu à ce stade.
6. **Bandeau de consentement** — inutile aujourd'hui, **obligatoire dès** l'ajout d'une mesure d'audience. À ce moment-là : refus aussi simple que l'acceptation, et dépôt **après** consentement seulement.
7. **Cookies Stripe** — l'intégration du paiement ajoutera `__stripe_mid` / `__stripe_sid` au catalogue.
8. **Contrôle de formule côté serveur** — la formule Premium vit dans `localStorage` (`lib/plan.ts`) et aucune route ne la vérifie. Sans rapport direct avec le RGPD, mais c'est le même genre de promesse non tenue : dès qu'il y a encaissement, vendre un accès que chacun débloque est déloyal envers ceux qui paient.

---

## 9. Règles de maintenance

À reprendre dans toute revue de code touchant à ces zones :

1. **Nouvelle clé de stockage côté navigateur** → l'ajouter à [`lib/traceurs.ts`](../frontend/src/lib/traceurs.ts) **dans le même commit**. `/mes-donnees` la signalera comme non répertoriée dans le cas contraire — le filet existe, mais il ne remplace pas la règle.
2. **Nouveau sous-traitant, nouvelle donnée collectée, ou durée de conservation modifiée** → mettre à jour `/confidentialite` (§5.1 donne la correspondance fichier ↔ affirmation) **avant** la mise en service.
3. **Nouvel appel `fetch` vers une route authentifiée** → y ajouter `...AVEC_SESSION`, sinon le cookie ne part pas et la route répond 401.
4. **Écran qui annonce une déconnexion** → passer par `logout()` ou `revoquerSession()`. Effacer le stockage local ne ferme pas la session.
5. **Changement de topologie de déploiement** (domaines du front et du back) → revoir `AUTH_COOKIE_SAMESITE` (§6.4).
6. **Changement de fournisseur LLM sur un chemin traitant des données de dossier** → mettre à jour la cartographie des transferts (§5.2), qui est une déclaration publique.
7. **Toute évolution tarifaire ou fonctionnelle annoncée dans ces pages** → penser au corpus RAG produit, réindexé par `backend/scripts/index_product_knowledge.py`, sinon le chatbot produit répondra l'ancienne version.

---

*Document de travail interne. Les pages `/cookies` et `/confidentialite` restent à faire valider par un juriste avant mise en ligne, au même titre que les CGV et les mentions légales.*
