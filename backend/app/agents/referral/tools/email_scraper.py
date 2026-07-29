"""Extraction d'un email de contact depuis le site web d'un cabinet.
Utilisé en fallback quand Overpass/l'API entreprise ne fournissent pas d'email.
En France, la page "Mentions légales" est obligatoire et contient souvent un contact direct.
"""
import re
import requests
from bs4 import BeautifulSoup
from typing import Optional
from urllib.parse import urljoin

# \b en début/fin évite de capturer un email collé à du texte adjacent (ex. "ContactEmailjean@x.com")
EMAIL_REGEX = re.compile(r"\b[a-zA-Z0-9_.+-]{1,64}@[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\b")

# Emails à ignorer (génériques, trackers, plateformes tierces sans rapport avec le cabinet)
BLOCKLIST_PATTERNS = (
    "noreply", "no-reply", "sentry", "example.com", "wixpress", "wix.com",
    "gravatar", "cloudflare", "gstatic", "doubleclick", "googleapis",
    "schema.org", "facebook.com",
)

# Un site pertinent (cabinet comptable) mentionne forcément ce type de terme.
# Sert à écarter les faux positifs de recherche (site sans rapport trouvé par erreur).
RELEVANCE_KEYWORDS = ("comptable", "expertise comptable", "expert-comptable")

CANDIDATE_PATHS = ["", "/contact", "/nous-contacter", "/mentions-legales", "/mentions-légales"]

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; comptable-agent-poc/1.0)"}


def _is_page_relevant(page_text: str) -> bool:
    text_lower = page_text.lower()
    return any(kw in text_lower for kw in RELEVANCE_KEYWORDS)


def _extract_emails_from_html(html: str) -> tuple:
    """Retourne (liste d'emails valides, page_pertinente: bool)."""
    soup = BeautifulSoup(html, "html.parser")

    # separator=" " est essentiel : sans lui, le texte de balises adjacentes
    # se colle sans espace et produit des emails corrompus (ex. mot précédent
    # fusionné avec le nom local de l'email).
    page_text = soup.get_text(separator=" ", strip=True)
    relevant = _is_page_relevant(page_text)

    # 1. Liens mailto: (les plus fiables, jamais sujets au bug de concaténation)
    mailto_emails = [
        a["href"].replace("mailto:", "").split("?")[0].strip()
        for a in soup.find_all("a", href=True)
        if a["href"].lower().startswith("mailto:")
    ]

    # 2. Regex sur le texte brut en secours
    text_emails = EMAIL_REGEX.findall(page_text)

    all_emails = mailto_emails + text_emails
    filtered = [
        e for e in dict.fromkeys(all_emails)  # dédoublonnage en gardant l'ordre
        if not any(bad in e.lower() for bad in BLOCKLIST_PATTERNS)
    ]
    return filtered, relevant


def extract_email_from_website(site_web: str) -> Optional[str]:
    if not site_web:
        return None
    if not site_web.startswith("http"):
        site_web = "https://" + site_web

    for path in CANDIDATE_PATHS:
        url = urljoin(site_web, path)
        try:
            resp = requests.get(url, headers=HEADERS, timeout=8)
            if resp.status_code != 200:
                continue
            emails, relevant = _extract_emails_from_html(resp.text)
            # On n'accepte un email QUE si la page mentionne "comptable" :
            # ça écarte les sites hors-sujet remontés par erreur par la recherche.
            if emails and relevant:
                return emails[0]
        except requests.RequestException:
            continue  # site injoignable ou page inexistante, on essaie le chemin suivant

    return None