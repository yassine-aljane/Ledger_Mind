"""L'export PDF doit reprendre EXACTEMENT la feuille de route affichée.

Un PDF qui divergerait de l'écran serait pire qu'absent : l'utilisateur l'emporte chez son
comptable ou au greffe, sans possibilité de recouper. On vérifie donc qu'aucune étape n'est
perdue en route, et qu'un parcours « société » ne laisse filtrer aucune étape « micro ».
"""

from __future__ import annotations

from html import escape

from app.agents.guidance.roadmap.parcours import build_roadmap
from app.agents.guidance.roadmap.pdf import _pdf_fpdf, roadmap_to_html


def test_pdf_societe_reprend_exactement_la_checklist():
    roadmap = build_roadmap({"ca_estime_annuel": 250000})
    html = roadmap_to_html(roadmap)

    assert "Créer ma société (EURL/SASU)" in html
    assert "VOTRE ITINÉRAIRE FISCAL" in html
    assert 'class="summary-grid"' in html
    assert "VOTRE PREMIER PAS" in html
    assert "Votre parcours en 3 temps" in html
    assert 'class="phase phase-preparer"' in html
    assert 'class="phase phase-faire_vivre"' in html
    assert html.count('class="journey-stop ') == len(roadmap["etapes"])
    assert "Créer ma micro-entreprise" not in html
    assert "URSSAF auto-entrepreneur" not in html
    for etape in roadmap["etapes"]:
        assert escape(etape["titre"]) in html
        assert escape(etape["detail"]) in html
        assert escape(etape["lien"]) in html


def test_pdf_windows_contient_la_page_itineraire_graphique():
    roadmap = build_roadmap({"ca_estime_annuel": 250000})

    pdf = _pdf_fpdf(roadmap)

    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 20_000
