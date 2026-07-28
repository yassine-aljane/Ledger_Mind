"""PDF créatif de la feuille de route — reflète EXACTEMENT le JSON déterministe de build_roadmap.

Page de couverture + récapitulatif (régime, seuils avec position) + une section par phase +
chaque étape en encadré (numéro, titre, badge, durée, coût, lien, case à cocher imprimable).
Palette du produit : marine, butter, prune, crème.

Deux moteurs : WeasyPrint (HTML/CSS riche) si les bibliothèques système GTK/Pango sont là ;
sinon repli fpdf2, 100 % Python (le cas Windows), avec la même mise en page.
"""
from __future__ import annotations

import io
import os
from datetime import date
from html import escape

# --- Palette produit (RGB) ---
NAVY = (27, 58, 95)
NAVY2 = (46, 92, 138)
NAVY_BG = (237, 242, 248)
BUTTER = (242, 217, 141)
BUTTER_BG = (251, 243, 220)
BUTTER_INK = (138, 109, 31)
PLUM = (122, 74, 99)
PLUM_BG = (243, 233, 239)
PLUM_INK = (102, 62, 83)
CREME = (253, 251, 246)
INK = (26, 26, 31)
MUTED = (107, 107, 117)
BORDER = (232, 227, 217)

_TITRES_PARCOURS = {
    "micro": "Créer ma micro-entreprise",
    "societe": "Créer ma société (EURL/SASU)",
    "bascule": "Micro ou société : arbitrer puis créer",
}
_PHASES_LIBELLES = {"preparer": "Préparer", "creer": "Créer", "faire_vivre": "Faire vivre"}
_PHASE_ORDRE = {"preparer": 1, "creer": 2, "faire_vivre": 3}

# Nuance de durabilité du régime micro (droit strict, règle des 2 années consécutives) :
# (titre, explication, variante de couleur). Reflète le champ `durabilite` du JSON.
_DURABILITE = {
    "eligible_stable": ("Éligibilité stable",
        "Votre chiffre d'affaires reste sous les plafonds micro : vous êtes éligible de plein droit.",
        "stable"),
    "depassement_ponctuel": ("Dépassement ponctuel — statut micro préservé",
        "Le plafond est dépassé cette année seulement. La tolérance de franchissement maintient le "
        "régime micro tant qu'il n'y a pas deux années consécutives au-dessus du plafond.",
        "warn"),
    "depassement_durable": ("Sortie du régime micro à prévoir",
        "Deuxième année consécutive de dépassement : la sortie du régime micro devient automatique. "
        "Il est temps d'anticiper le passage à un régime réel ou à une société.",
        "alert"),
    "indetermine": ("À confirmer selon votre CA de l'an dernier",
        "Le plafond est dépassé cette année. Pour déterminer si vous restez en micro, il faut connaître "
        "votre chiffre d'affaires de l'an dernier (sortie seulement après deux années consécutives).",
        "warn"),
}


def _durabilite_bloc(roadmap: dict) -> tuple[str, str, str] | None:
    """(titre, texte, variante) pour la nuance de durabilité, ou None si inconnue."""
    return _DURABILITE.get(roadmap.get("durabilite"))


def _fmt_source_valeur(valeur) -> str:
    """Un taux stocké en fraction (0 < v < 1) est affiché en pourcentage ; le reste tel quel
    (les montants restent des entiers, les intervalles « 37500 / 41250 » des chaînes)."""
    if isinstance(valeur, float) and 0 < valeur < 1:
        pct = f"{valeur * 100:.2f}".rstrip("0").rstrip(".")
        return f"{pct} %".replace(".", ",")
    return str(valeur)
_DISCLAIMER = ("Document d'aide à la préparation, généré automatiquement — il ne constitue pas un "
               "conseil fiscal engageant. Les seuils et montants (année en cours) sont à vérifier "
               "sur les sites officiels (impots.gouv.fr, urssaf.fr, service-public.fr).")


def _titre_document(roadmap: dict) -> str:
    return _TITRES_PARCOURS.get(roadmap.get("parcours", "micro"), "Ma feuille de route")


def _phases(roadmap: dict) -> list[dict]:
    ph = roadmap.get("phases")
    if ph:
        return sorted(ph, key=lambda p: _PHASE_ORDRE.get(p.get("id"), 9))
    return [{"id": None, "titre": "Étapes", "etapes": roadmap.get("etapes", [])}]


# ======================================================================== WeasyPrint (HTML)
def roadmap_to_html(roadmap: dict) -> str:
    profil = roadmap.get("profil", {})
    bandeau = roadmap.get("bandeau", {})
    seuils = roadmap.get("seuils_profil", [])
    activite = escape(str(profil.get("activite", "création de contenu")))
    ca = profil.get("ca_estime_annuel") or profil.get("ca_estime") or 0
    ca_fmt = f"{ca:,.0f}".replace(",", " ")

    def barre(s):
        ratio = (s["position"] / s["seuil"]) if s.get("seuil") else 0
        warn = ratio >= 0.9
        w = max(3, min(100, ratio * 100))
        col = "#7A4A63" if warn else "#2E5C8A"
        return (f'<div class="g"><div class="gl"><span>{escape(s["label"])}</span>'
                f'<span>{s["position"]:,.0f} € / {s["seuil"]:,.0f} €</span></div>'
                f'<div class="gt"><div class="gf" style="width:{w}%;background:{col}"></div></div></div>'
                ).replace(",", " ")

    sections = []
    n = 0
    for i, phase in enumerate(_phases(roadmap), 1):
        cartes = []
        for e in phase.get("etapes", []):
            n += 1
            badge = "Obligatoire" if e.get("obligatoire") else "Recommandé"
            bcls = "obl" if e.get("obligatoire") else "reco"
            tags = ""
            if e.get("duree"):
                tags += f'<span class="tag">{escape(str(e["duree"]))}</span>'
            if e.get("cout"):
                tags += f'<span class="tag cost">{escape(str(e["cout"]))}</span>'
            cartes.append(f"""
              <div class="etape">
                <div class="chk"></div>
                <div class="num">{n}</div>
                <div class="corps">
                  <div class="tl"><span class="titre">{escape(e['titre'])}</span>
                    <span class="badge {bcls}">{badge}</span></div>
                  <div class="tags">{tags}</div>
                  <p class="detail">{escape(e.get('detail',''))}</p>
                  <a class="lien" href="{escape(e.get('lien',''))}">{escape(e.get('lien',''))}</a>
                </div>
              </div>""")
        sections.append(f'<div class="phase"><div class="ph">Phase {i} — '
                        f'{escape(_PHASES_LIBELLES.get(phase.get("id"), phase.get("titre","Étapes")))}'
                        f'</div>{"".join(cartes)}</div>')

    # Bandeau de durabilité (nuance ponctuel / durable / indéterminé / stable).
    dur = _durabilite_bloc(roadmap)
    dur_html = (f'<div class="dur {dur[2]}"><strong>{escape(dur[0])}</strong> {escape(dur[1])}</div>'
                if dur else "")

    # Comparatif Micro vs Société (uniquement en zone de bascule).
    comparatif = roadmap.get("comparatif")
    cmp_html = ""
    if comparatif:
        thead = "".join(f"<th>{escape(c)}</th>" for c in comparatif.get("colonnes", []))
        trows = "".join("<tr>" + "".join(f"<td>{escape(str(c))}</td>" for c in ligne) + "</tr>"
                        for ligne in comparatif.get("lignes", []))
        cmp_html = (f'<div class="cmp-title">Micro-entreprise ou société : le comparatif</div>'
                    f'<table class="cmp"><thead><tr>{thead}</tr></thead><tbody>{trows}</tbody></table>'
                    f'<div class="cmp-rule">{escape(comparatif.get("regle_franchissement",""))}</div>')

    # Sources légales datées (remplacent le seul disclaimer générique).
    sources = roadmap.get("legal_sources", [])
    src_items = "".join(
        f'<li><strong>{escape(str(ls.get("label","")))}</strong> : {escape(_fmt_source_valeur(ls.get("valeur","")))} '
        f'<span class="src-meta">(année {escape(str(ls.get("annee","")))}, vérifié le '
        f'{escape(str(ls.get("date_verif","")))})</span><br>'
        f'<span class="src-url">{escape(str(ls.get("source","")))}</span></li>'
        for ls in sources)
    src_html = (f'<div class="sources"><div class="src-title">Sources légales officielles</div>'
                f'<ul>{src_items}</ul></div>' if src_items else "")

    return f"""<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><style>
  @page {{ size:A4; margin:16mm; }}
  * {{ font-family:'Inter','Helvetica','Arial',sans-serif; }}
  body {{ color:#1A1A1F; }}
  .cover {{ background:#1B3A5F; color:#FDFBF6; margin:-16mm -16mm 16px; padding:34px 16mm 26px; }}
  .cover .brand {{ font-size:14px; letter-spacing:.08em; opacity:.85; }}
  .cover h1 {{ font-size:26px; margin:6px 0 14px; }}
  .cover .pill {{ display:inline-block; background:#F2D98D; color:#8A6D1F; font-weight:700;
                  padding:5px 14px; border-radius:20px; font-size:13px; }}
  .cover .meta {{ margin-top:14px; font-size:12.5px; opacity:.92; }}
  .regime {{ background:#EDF2F8; border:1px solid #2E5C8A; border-radius:12px; padding:12px 14px;
             font-size:12.5px; margin:0 0 12px; color:#1B3A5F; }}
  .dur {{ border-radius:12px; padding:11px 14px; font-size:12.5px; margin:0 0 16px; line-height:1.45; }}
  .dur.stable {{ background:#EDF2F8; color:#1B3A5F; border:1px solid #2E5C8A; }}
  .dur.warn {{ background:#FBF3DC; color:#8A6D1F; border:1px solid #F2D98D; }}
  .dur.alert {{ background:#F3E9EF; color:#663E53; border:1px solid #7A4A63; }}
  .cmp-title {{ font-weight:700; font-size:13px; color:#1B3A5F; margin:18px 0 8px; }}
  .cmp {{ width:100%; border-collapse:collapse; font-size:11px; margin-bottom:6px; }}
  .cmp th {{ background:#1B3A5F; color:#FDFBF6; text-align:left; padding:6px 8px; font-size:11px; }}
  .cmp td {{ border:1px solid #E8E3D9; padding:6px 8px; vertical-align:top; color:#44403c; }}
  .cmp tbody tr:nth-child(even) td {{ background:#FDFBF6; }}
  .cmp td:first-child {{ font-weight:600; color:#1A1A1F; width:22%; }}
  .cmp-rule {{ font-size:10.5px; color:#6B6B75; font-style:italic; margin-bottom:6px; }}
  .sources {{ margin-top:18px; page-break-inside:avoid; }}
  .src-title {{ font-weight:700; font-size:12.5px; color:#1B3A5F; margin-bottom:6px; }}
  .sources ul {{ list-style:none; padding:0; margin:0; }}
  .sources li {{ font-size:10.5px; color:#44403c; margin-bottom:6px; border-left:2px solid #F2D98D; padding-left:9px; }}
  .src-meta {{ color:#6B6B75; }}
  .src-url {{ color:#2E5C8A; font-size:9.5px; word-break:break-all; }}
  .g {{ margin:8px 0; }}
  .gl {{ display:flex; justify-content:space-between; font-size:11.5px; color:#6B6B75; margin-bottom:3px; }}
  .gt {{ height:7px; background:#EFEAE0; border-radius:5px; overflow:hidden; }}
  .gf {{ height:100%; border-radius:5px; }}
  .phase {{ margin-top:16px; page-break-inside:avoid; }}
  .ph {{ background:#1B3A5F; color:#FDFBF6; font-weight:700; font-size:13px; padding:7px 12px;
         border-radius:8px; margin-bottom:10px; }}
  .etape {{ display:flex; gap:10px; align-items:flex-start; border:1px solid #E8E3D9;
            border-radius:11px; padding:11px 12px; margin-bottom:9px; page-break-inside:avoid; }}
  .chk {{ width:15px; height:15px; border:2px solid #C9C2B4; border-radius:4px; flex:0 0 15px; margin-top:2px; }}
  .num {{ min-width:24px; height:24px; border-radius:7px; background:#EDF2F8; color:#1B3A5F;
          font-weight:700; font-size:12px; display:flex; align-items:center; justify-content:center; }}
  .tl {{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }}
  .titre {{ font-weight:600; font-size:13.5px; color:#1A1A1F; }}
  .badge {{ font-size:10px; padding:2px 9px; border-radius:20px; font-weight:700; }}
  .obl {{ background:#FBF3DC; color:#8A6D1F; }}
  .reco {{ background:#FDFBF6; color:#6B6B75; border:1px solid #E8E3D9; }}
  .tags {{ margin:5px 0 2px; }}
  .tag {{ font-size:10.5px; color:#6B6B75; border:1px solid #E8E3D9; border-radius:6px; padding:1px 7px; margin-right:6px; }}
  .tag.cost {{ color:#1B3A5F; border-color:#2E5C8A; background:#EDF2F8; }}
  .detail {{ font-size:11.5px; color:#44403c; margin:5px 0 3px; line-height:1.45; }}
  .lien {{ font-size:10.5px; color:#2E5C8A; text-decoration:none; }}
  .foot {{ margin-top:20px; font-size:9.5px; color:#6B6B75; border-top:1px solid #E8E3D9; padding-top:9px; }}
</style></head><body>
  <div class="cover">
    <div class="brand">LEDGERMIND</div>
    <h1>{escape(_titre_document(roadmap))}</h1>
    <span class="pill">{escape(bandeau.get('titre',''))}</span>
    <div class="meta">Activité : {activite} &nbsp;·&nbsp; CA estimé : {ca_fmt} €
      &nbsp;·&nbsp; généré le {date.today().strftime('%d/%m/%Y')}</div>
  </div>
  <div class="regime"><strong>Votre situation.</strong> {escape(bandeau.get('texte',''))}</div>
  {dur_html}
  {''.join(barre(s) for s in seuils[:3])}
  {cmp_html}
  {''.join(sections)}
  {src_html}
  <div class="foot">{escape(_DISCLAIMER)}</div>
</body></html>"""


def _pdf_weasyprint(roadmap: dict) -> bytes:
    from weasyprint import HTML

    buf = io.BytesIO()
    HTML(string=roadmap_to_html(roadmap)).write_pdf(buf)
    return buf.getvalue()


# ======================================================================== Repli fpdf2 (pur Python)
_FONT_CANDIDATES = [
    ("arial", r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\arialbd.ttf"),
    ("segoeui", r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\segoeuib.ttf"),
    ("dejavu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
     "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
]
_LATIN1_REPL = {"—": "-", "–": "-", "’": "'", "‘": "'", "“": '"', "”": '"', "…": "...",
                "€": " EUR", "«": '"', "»": '"', "→": "->", " ": " ", " ": " ", "•": "-"}


def _setup_font(pdf) -> tuple[str, bool]:
    for family, reg, bold in _FONT_CANDIDATES:
        if os.path.exists(reg):
            pdf.add_font(family, "", reg)
            pdf.add_font(family, "B", bold if os.path.exists(bold) else reg)
            return family, True
    return "helvetica", False


def _eur(n) -> str:
    try:
        return f"{float(n):,.0f} EUR".replace(",", " ")
    except (TypeError, ValueError):
        return str(n)


def _pdf_fpdf(roadmap: dict) -> bytes:
    from fpdf import FPDF

    profil = roadmap.get("profil", {})
    bandeau = roadmap.get("bandeau", {})
    seuils = roadmap.get("seuils_profil", [])
    activite = str(profil.get("activite", "création de contenu"))
    ca = profil.get("ca_estime_annuel") or profil.get("ca_estime") or 0

    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.set_margins(16, 16, 16)
    pdf.add_page()
    fam, uni = _setup_font(pdf)
    L, R = pdf.l_margin, pdf.w - pdf.r_margin
    CW = R - L

    def s(t: object) -> str:
        text = str(t)
        if uni:
            return text
        for k, v in _LATIN1_REPL.items():
            text = text.replace(k, v)
        return text.encode("latin-1", "replace").decode("latin-1")

    def color(setter, rgb):
        setter(*rgb)

    # ---------- Bandeau de couverture (marine) ----------
    color(pdf.set_fill_color, NAVY)
    pdf.rect(0, 0, pdf.w, 58, style="F")
    pdf.set_xy(L, 14)
    pdf.set_font(fam, "B", 11)
    color(pdf.set_text_color, CREME)
    pdf.cell(0, 6, s("LEDGERMIND"))
    pdf.set_xy(L, 22)
    pdf.set_font(fam, "B", 22)
    pdf.multi_cell(CW, 10, s(_titre_document(roadmap)))

    # Badge parcours (butter) sous le bandeau
    y = 64
    label = bandeau.get("titre", "")
    pdf.set_font(fam, "B", 11)
    bw = pdf.get_string_width(s(label)) + 12
    color(pdf.set_fill_color, BUTTER)
    color(pdf.set_text_color, BUTTER_INK)
    pdf.set_xy(L, y)
    pdf.cell(bw, 9, s(label), align="C", fill=True)
    pdf.set_xy(L, y + 12)
    pdf.set_font(fam, "", 10)
    color(pdf.set_text_color, MUTED)
    pdf.multi_cell(CW, 5, s(f"Activité : {activite}   ·   CA estimé : {_eur(ca)}   ·   "
                            f"généré le {date.today().strftime('%d/%m/%Y')}"))
    pdf.ln(3)

    # ---------- Récapitulatif : régime + seuils ----------
    color(pdf.set_fill_color, NAVY_BG)
    color(pdf.set_text_color, NAVY)
    pdf.set_font(fam, "", 10)
    pdf.set_x(L)
    pdf.multi_cell(CW, 5.5, s("Votre situation. " + (bandeau.get("texte", ""))), border=0, fill=True)
    pdf.ln(2)

    # ---------- Bandeau de durabilité (nuance ponctuel / durable / indéterminé / stable) ----------
    dur = _durabilite_bloc(roadmap)
    if dur:
        titre_d, texte_d, variante = dur
        bg, ink = {"stable": (NAVY_BG, NAVY), "warn": (BUTTER_BG, BUTTER_INK),
                   "alert": (PLUM_BG, PLUM_INK)}[variante]
        color(pdf.set_fill_color, bg)
        color(pdf.set_text_color, ink)
        pdf.set_x(L)
        pdf.set_font(fam, "B", 9.5)
        pdf.multi_cell(CW, 5, s(titre_d), fill=True)
        pdf.set_x(L)
        pdf.set_font(fam, "", 9)
        pdf.multi_cell(CW, 4.6, s(texte_d), fill=True)
        pdf.ln(3)

    for sp in seuils[:3]:
        seuil = sp.get("seuil") or 0
        pos = sp.get("position") or 0
        ratio = (pos / seuil) if seuil else 0
        warn = ratio >= 0.9
        pdf.set_x(L)
        pdf.set_font(fam, "", 9)
        color(pdf.set_text_color, MUTED)
        pdf.cell(CW * 0.6, 5, s(sp.get("label", "")))
        pdf.cell(CW * 0.4, 5, s(f"{_eur(pos)} / {_eur(seuil)}"), align="R")
        pdf.ln(5)
        by = pdf.get_y()
        color(pdf.set_fill_color, (239, 234, 224))
        pdf.rect(L, by, CW, 2.4, style="F")
        color(pdf.set_fill_color, PLUM if warn else NAVY2)
        pdf.rect(L, by, CW * max(0.02, min(1, ratio)), 2.4, style="F")
        pdf.ln(5)

    # ---------- Comparatif Micro vs Société (zone de bascule uniquement) ----------
    comparatif = roadmap.get("comparatif")
    if comparatif and comparatif.get("lignes"):
        from fpdf.fonts import FontFace

        pdf.ln(2)
        if pdf.get_y() > pdf.h - pdf.b_margin - 46:
            pdf.add_page()
        pdf.set_x(L)
        pdf.set_font(fam, "B", 11)
        color(pdf.set_text_color, NAVY)
        pdf.cell(0, 6, s("Micro ou société : le comparatif"))
        pdf.ln(8)
        headings = FontFace(emphasis="BOLD", color=CREME, fill_color=NAVY)
        pdf.set_font(fam, "", 8)
        color(pdf.set_text_color, INK)
        color(pdf.set_draw_color, BORDER)
        with pdf.table(width=CW, col_widths=(24, 38, 38), headings_style=headings,
                       line_height=5, text_align="LEFT", padding=1.6) as table:
            entete = table.row()
            for c in comparatif.get("colonnes", []):
                entete.cell(s(str(c)))
            for ligne in comparatif["lignes"]:
                rang = table.row()
                for cellule in ligne:
                    rang.cell(s(str(cellule)))
        pdf.ln(1)
        pdf.set_x(L)
        pdf.set_font(fam, "", 8)
        color(pdf.set_text_color, MUTED)
        pdf.multi_cell(CW, 4, s(comparatif.get("regle_franchissement", "")))
        pdf.ln(2)

    # ---------- Phases + étapes ----------
    n = 0
    for i, phase in enumerate(_phases(roadmap), 1):
        if pdf.get_y() > pdf.h - pdf.b_margin - 30:
            pdf.add_page()
        # Bandeau de phase (marine)
        pdf.ln(2)
        py = pdf.get_y()
        color(pdf.set_fill_color, NAVY)
        pdf.rect(L, py, CW, 8, style="F")
        pdf.set_xy(L + 3, py + 1)
        pdf.set_font(fam, "B", 11)
        color(pdf.set_text_color, CREME)
        titre_phase = _PHASES_LIBELLES.get(phase.get("id"), phase.get("titre", "Étapes"))
        pdf.cell(0, 6, s(f"Phase {i} — {titre_phase}"))
        pdf.ln(11)

        for e in phase.get("etapes", []):
            n += 1
            if pdf.get_y() > pdf.h - pdf.b_margin - 34:
                pdf.add_page()
            box_y0 = pdf.get_y()
            inner_l = L + 4
            inner_w = CW - 8
            # Case à cocher imprimable + numéro
            color(pdf.set_draw_color, (201, 194, 180))
            pdf.rect(inner_l, box_y0 + 2, 4.5, 4.5, style="D")
            color(pdf.set_fill_color, NAVY_BG)
            pdf.rect(inner_l + 7, box_y0 + 1, 7, 7, style="F")
            pdf.set_xy(inner_l + 7, box_y0 + 1.6)
            pdf.set_font(fam, "B", 10)
            color(pdf.set_text_color, NAVY)
            pdf.cell(7, 5, s(str(n)), align="C")
            # Titre
            tx = inner_l + 17
            tw = inner_w - 17
            pdf.set_xy(tx, box_y0)
            pdf.set_font(fam, "B", 11)
            color(pdf.set_text_color, INK)
            pdf.multi_cell(tw, 5.6, s(e.get("titre", "")))
            # Badge + tags (durée / coût)
            pdf.set_x(tx)
            if e.get("obligatoire"):
                color(pdf.set_fill_color, BUTTER_BG)
                color(pdf.set_text_color, BUTTER_INK)
                badge = "Obligatoire"
            else:
                color(pdf.set_fill_color, CREME)
                color(pdf.set_text_color, MUTED)
                badge = "Recommandé"
            pdf.set_font(fam, "B", 7.5)
            pdf.cell(pdf.get_string_width(s(badge)) + 6, 4.6, s(badge), align="C", fill=True)
            pdf.set_font(fam, "", 8)
            color(pdf.set_text_color, MUTED)
            for tag in (e.get("duree"), e.get("cout")):
                if tag:
                    pdf.cell(2, 4.6, "")
                    pdf.cell(pdf.get_string_width(s(tag)) + 4, 4.6, s(tag), align="C")
            pdf.ln(6.5)
            # Détail
            pdf.set_x(tx)
            pdf.set_font(fam, "", 9)
            color(pdf.set_text_color, (68, 64, 60))
            pdf.set_left_margin(tx)
            pdf.multi_cell(tw, 4.6, s(e.get("detail", "")))
            # Lien
            if e.get("lien"):
                pdf.set_x(tx)
                pdf.set_font(fam, "", 8)
                color(pdf.set_text_color, NAVY2)
                pdf.multi_cell(tw, 4.3, s(e["lien"]))
            pdf.set_left_margin(L)
            box_y1 = pdf.get_y()
            # Encadré autour de l'étape
            color(pdf.set_draw_color, BORDER)
            try:
                pdf.rect(L, box_y0 - 2, CW, (box_y1 - box_y0) + 5, style="D",
                         round_corners=True, corner_radius=3)
            except TypeError:
                pdf.rect(L, box_y0 - 2, CW, (box_y1 - box_y0) + 5, style="D")
            pdf.ln(4)

    # ---------- Sources légales officielles (datées) ----------
    sources = roadmap.get("legal_sources", [])
    if sources:
        pdf.ln(2)
        if pdf.get_y() > pdf.h - pdf.b_margin - 28:
            pdf.add_page()
        pdf.set_x(L)
        pdf.set_font(fam, "B", 10)
        color(pdf.set_text_color, NAVY)
        pdf.cell(0, 6, s("Sources légales officielles"))
        pdf.ln(7)
        for ls in sources:
            if pdf.get_y() > pdf.h - pdf.b_margin - 16:
                pdf.add_page()
            pdf.set_x(L)
            pdf.set_font(fam, "B", 8.5)
            color(pdf.set_text_color, INK)
            pdf.multi_cell(CW, 4.4, s(f"{ls.get('label', '')} : {_fmt_source_valeur(ls.get('valeur', ''))}"))
            pdf.set_x(L)
            pdf.set_font(fam, "", 7.5)
            color(pdf.set_text_color, MUTED)
            pdf.multi_cell(CW, 3.8, s(f"Année {ls.get('annee', '')} · vérifié le {ls.get('date_verif', '')}"))
            pdf.set_x(L)
            color(pdf.set_text_color, NAVY2)
            pdf.multi_cell(CW, 3.8, s(str(ls.get("source", ""))))
            pdf.ln(1.5)

    # ---------- Pied de page ----------
    pdf.ln(2)
    pdf.set_x(L)
    color(pdf.set_draw_color, BORDER)
    pdf.set_font(fam, "", 7.5)
    color(pdf.set_text_color, MUTED)
    pdf.multi_cell(0, 4, s(_DISCLAIMER), border="T")
    return bytes(pdf.output())


def roadmap_to_pdf(roadmap: dict) -> bytes:
    """Rend la roadmap en PDF. WeasyPrint si disponible (GTK), sinon repli fpdf2 (pur Python)."""
    try:
        return _pdf_weasyprint(roadmap)
    except Exception:
        return _pdf_fpdf(roadmap)
