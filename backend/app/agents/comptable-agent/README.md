# Agent Comptable

Système multi-agents (orchestrateur + agent de recherche + agent de génération d'email)
qui trouve des experts-comptables dans une ville française et génère un brouillon
d'email personnalisé par cabinet, prêt à relire et envoyer.

100% gratuit à l'exception de l'appel LLM (Mistral, offre gratuite disponible).

## Architecture

```
main.py                  → point d'entrée CLI
orchestrator.py          → graphe LangGraph (recherche → génération, gestion des échecs)
state.py                 → state partagé entre les noeuds (AgentState)
search_agent.py           → agent de recherche des cabinets comptables
email_agent.py             → agent de génération des emails (Mistral)
config.py                 → configuration (endpoints, clés, constantes)
tools/
  geocode.py               → géocodage ville → lat/lon (Nominatim, gratuit)
  overpass.py               → recherche des cabinets (Overpass API / OpenStreetMap, gratuit)
  entreprise_api.py          → complément via l'API officielle Recherche d'Entreprises (gratuit)
  email_scraper.py           → extraction d'email depuis le site/mentions légales du cabinet
```

## Flux

```
ville + demande + infos utilisateur
        │
        ▼
  [Agent Recherche]
   1. Géocodage de la ville (Nominatim)
   2. Recherche des cabinets (Overpass API)
   3. Complément (API Recherche d'Entreprises, NAF 69.20Z)
   4. Pour chaque cabinet sans email → scraping du site (page contact/mentions légales)
        │
        ├── aucun résultat / ville introuvable → noeud "echec" → message clair à l'utilisateur
        │
        ▼
  [Agent Génération] (pour chaque cabinet trouvé)
   → email personnalisé (nom du cabinet, demande, infos utilisateur), ton professionnel
        │
        ▼
  Liste de brouillons → validation/édition manuelle → envoi (hors scope de cet agent)
```

## Installation

```bash
pip install -r requirements.txt
cp .env.example .env
# éditer .env : ajouter MISTRAL_API_KEY (gratuit sur console.mistral.ai)
```

## Utilisation

```bash
python main.py \
  --ville "Lyon" \
  --demande "Je suis en micro-entreprise BNC, j'ai besoin d'aide pour ma première déclaration de TVA." \
  --nom "Fourat B." \
  --statut "Micro-entreprise (BNC)" \
  --situation "Première année d'activité, régime de la franchise en base de TVA"
```

## Limites connues (POC)

- Overpass API (OpenStreetMap) n'a pas une couverture exhaustive de tous les cabinets
  comptables français — certaines zones seront moins bien couvertes que d'autres.
- L'extraction d'email par scraping échoue si le site n'expose que des formulaires de
  contact (pas d'email en clair). Dans ce cas l'email est marqué "non trouvé" et
  l'utilisateur doit compléter manuellement.
- Aucun envoi automatique : c'est un choix de conception (validation humaine obligatoire
  avant tout envoi vers un tiers).
- Nominatim impose une limite de ~1 requête/seconde — suffisant pour un usage
  interactif, à adapter si vous scalez (mettre en cache les géocodages).
