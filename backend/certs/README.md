# Clés de signature des contenus IA

Ce dossier porte la chaîne cryptographique qui signe les contenus générés par LedgerMind
(PDF, images, texte), au titre de l'**article 50(2) du règlement européen sur l'IA** :
tout contenu synthétique doit être marqué dans un **format lisible par machine**. La
signature C2PA est le marquage retenu ici — elle atteste *qui* a produit le contenu et
*avec quel outil*, et cette attestation survit au téléchargement et au repartage.

## Ce que contient le dossier

| Fichier | Rôle | Versionné |
|---|---|---|
| `c2pa-openssl.cnf` | profil X.509 conforme C2PA | oui |
| `c2pa-ca.key` | clé privée de l'autorité interne | **non** |
| `c2pa-ca.crt` | certificat racine — l'ancre de confiance à publier | oui |
| `c2pa-signer.key` | clé privée de signature ES256, lue par le backend | **non** |
| `c2pa-signer.crt` | certificat feuille | non |
| `c2pa-chain.pem` | feuille + racine, format attendu par `c2pa-python` | non |

## Générer / régénérer

```bash
python backend/scripts/generer_cles_signature.py            # génère si absent
python backend/scripts/generer_cles_signature.py --verifier # contrôle la chaîne en place
python backend/scripts/generer_cles_signature.py --force    # régénère (écrase)
```

Puis dans `backend/.env` :

```dotenv
C2PA_SIGNER_KEY=backend/certs/c2pa-signer.key
C2PA_SIGNER_CHAIN=backend/certs/c2pa-chain.pem
C2PA_SIGNER_ALG=es256
```

Sans ces variables, le backend continue de fonctionner : il pose les métadonnées de
document dans les PDF et les en-têtes HTTP de transparence, mais **pas** la signature
C2PA. Le marquage visible, lui, ne dépend d'aucune clé et reste toujours actif.

## Ce que la signature couvre — et ce qu'elle ne couvre pas

| Contenu | Marquage machine | Signé |
|---|---|---|
| Images, audio, vidéo (PNG, JPEG, WebP, MP4, MP3…) | manifeste C2PA incrusté | **oui** |
| PDF (facture, rapport, feuille de route, déclarations) | métadonnées de document | non |
| Réponses d'API (texte généré) | en-têtes `X-AI-*` | non |
| Pages du site | `<meta>` + JSON-LD schema.org | non |

**Le PDF n'est pas signable en C2PA.** Ni le SDK ni la liste du guide (JPEG, PNG, MP4,
MP3, WebM) ne couvrent ce format. Le marquage lisible par machine des documents passe donc
intégralement par le dictionnaire Info du PDF, écrit par `ai_act.marquer_pdf()` : conforme
à l'article 50(2), simplement non cryptographique. `ai_act.format_signable()` interroge le
SDK plutôt qu'une liste figée, pour que le jour où le PDF devient signable, rien d'autre
n'ait à changer.

## Format de clé

La clé privée doit être en **PKCS#8** (`-----BEGIN PRIVATE KEY-----`). Le SDK refuse le
format SEC1 (`-----BEGIN EC PRIVATE KEY-----`) que produit `openssl ecparam -genkey`, avec
l'erreur `unexpected PEM type label`. Le script utilise `openssl genpkey`, qui écrit
directement du PKCS#8, et le vérifie explicitement — une clé SEC1 passe tous les autres
contrôles et n'échoue qu'au moment de signer. Pour convertir une clé existante :

```bash
openssl pkcs8 -topk8 -nocrypt -in ancienne.key -out nouvelle.key
```

## Pourquoi deux certificats et pas un auto-signé

C2PA valide une *chaîne*. Une feuille de signature doit porter `CA:FALSE` ; un certificat
auto-signé unique porte forcément `CA:TRUE` puisqu'il s'émet lui-même. Le validateur le
rejette. On génère donc une autorité interne (`CA:TRUE`, `keyCertSign`) qui émet une feuille
(`CA:FALSE`, `digitalSignature`, EKU `emailProtection`) — c'est le profil exact que la
spécification impose, et il est vérifié à chaque exécution du script.

## Portée de confiance de la chaîne actuelle

La racine générée ici est **interne**. Concrètement :

- la signature se vérifie techniquement — le manifeste est lisible, l'intégrité du fichier
  est prouvée, toute retouche postérieure est détectée ;
- l'émetteur n'est ancré dans aucune liste de confiance publique. Les outils de vérification
  (Content Credentials, c2patool) afficheront « signature valide, émetteur non reconnu ».

Concrètement, une image signée avec la chaîne actuelle est relue ainsi :

```
succès : claimSignature.validated, assertion.dataHash.match, …
échec  : signingCredential.untrusted
```

Le seul échec porte sur l'ancrage de l'émetteur, pas sur la signature. C'est suffisant pour
le développement, les tests et un déploiement interne. Ça satisfait l'obligation de
marquage *lisible par machine* de l'article 50(2), qui n'exige pas une AC publique. Pour que l'attribution soit reconnue par les plateformes tierces, il faut ensuite
un certificat émis par une AC présente dans la **C2PA Known Certificate List** — la
procédure passe par une AC partenaire (DigiCert, GlobalSign…) avec un certificat de type
*document signing*. Seuls les deux chemins de `.env` changent alors ; aucun code ne bouge.

## Rotation et incident

- **Rotation planifiée** — la feuille expire à 2 ans. Régénérez-la avant échéance ;
  conservez l'ancienne racine publiée, sinon les contenus déjà signés deviennent
  invérifiables.
- **Clé compromise** — régénérez immédiatement avec `--force`, retirez l'ancienne racine
  des listes de confiance, et considérez comme non attribuables tous les contenus signés
  depuis la date probable de compromission.
- `c2pa-ca.key` n'a besoin d'être présente que le jour où l'on émet une nouvelle feuille.
  Le reste du temps, sortez-la de la machine de production.
