from html import escape

from app.roadmap.parcours import build_roadmap
from app.roadmap.pdf import roadmap_to_html


def test_pdf_societe_reprend_exactement_la_checklist():
    roadmap = build_roadmap({"ca_estime_annuel": 250000})
    html = roadmap_to_html(roadmap)

    assert "Créer ma société (EURL/SASU)" in html
    assert "Créer ma micro-entreprise" not in html
    assert "URSSAF auto-entrepreneur" not in html
    for etape in roadmap["etapes"]:
        assert escape(etape["titre"]) in html
        assert escape(etape["detail"]) in html
        assert escape(etape["lien"]) in html
