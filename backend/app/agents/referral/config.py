"""Configuration centrale de l'agent referral."""
import os

from app.config import settings

MISTRAL_API_KEY = settings.mistral_api_key or os.getenv("MISTRAL_API_KEY") or ""
NOMINATIM_USER_AGENT = os.getenv(
    "NOMINATIM_USER_AGENT",
    "LedgerMind-ComptableAgent/1.0 (contact: support@ledgermind.local)",
)

# Endpoints (tous gratuits, sans clé API sauf Mistral)
ADRESSE_API_URL = "https://api-adresse.data.gouv.fr/search"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
ENTREPRISE_API_URL = "https://recherche-entreprises.api.gouv.fr/search"

# Rayon de recherche autour de la ville (mètres)
SEARCH_RADIUS_M = 8000

# Nombre max de cabinets traités par run (évite de spammer les sites lors des tests).
# 5 suffit pour la carte + emails, et coupe le temps vs 8 en série.
MAX_RESULTS = 5

MODEL_NAME = "mistral-small-latest"
