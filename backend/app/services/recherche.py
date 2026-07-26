import httpx
from app.core.http_client import get_http_client

_BASE = "https://recherche-entreprises.api.gouv.fr"


async def fetch_company_by_siren(siren: str) -> dict | None:
    """Fetches the first company matching the siren from the recherche-entreprises API.
    
    Raises httpx.HTTPError on connection or API request errors so callers can handle them.
    """
    siren = siren.replace(" ", "")
    client = get_http_client()

    resp = await client.get(
        f"{_BASE}/search",
        params={"q": siren, "page": 1, "per_page": 1},
    )

    if resp.status_code != 200:
        return None

    data = resp.json()
    results = data.get("results", [])

    if not results:
        return None

    company = results[0]

    if company.get("siren") != siren:
        return None

    return company
