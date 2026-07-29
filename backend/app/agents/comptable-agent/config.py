"""Configuration centrale du projet."""
import os
from dotenv import load_dotenv

load_dotenv()

MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")
NOMINATIM_USER_AGENT = os.getenv(
    "NOMINATIM_USER_AGENT", "comptable-agent-poc (contact: example@example.com)"
)

# Endpoints (tous gratuits, sans clé API sauf Mistral)
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
ENTREPRISE_API_URL = "https://recherche-entreprises.api.gouv.fr/search"

# Rayon de recherche autour de la ville (mètres)
SEARCH_RADIUS_M = 8000

# Nombre max de cabinets traités par run (évite de spammer les sites lors des tests)
MAX_RESULTS = 8

MODEL_NAME = "mistral-small-latest"
