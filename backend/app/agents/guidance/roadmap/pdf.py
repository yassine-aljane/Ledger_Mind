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


def _itinerary_steps(roadmap: dict) -> list[tuple[str, dict]]:
    """Étapes ordonnées avec leur phase, pour la page d'itinéraire graphique."""
    return [
        (phase.get("id") or "preparer", etape)
        for phase in _phases(roadmap)
        for etape in phase.get("etapes", [])
    ]


# ======================================================================== WeasyPrint (HTML)
def roadmap_to_html(roadmap: dict) -> str:
    profil = roadmap.get("profil", {})
    bandeau = roadmap.get("bandeau", {})
    seuils = roadmap.get("seuils_profil", [])
    activite = escape(str(profil.get("activite", "création de contenu")))
    ca = profil.get("ca_estime_annuel") or profil.get("ca_estime") or 0
    ca_fmt = f"{ca:,.0f}".replace(",", " ")
    itinerary = _itinerary_steps(roadmap)
    active_phases = [phase for phase in _phases(roadmap) if phase.get("etapes")]
    phase_count = len(active_phases)
    parcours_court = {"micro": "Micro", "societe": "Société", "bascule": "Arbitrage"}.get(
        roadmap.get("parcours"), "Personnalisé")

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
        phase_id = escape(str(phase.get("id") or "preparer"))
        phase_title = escape(_PHASES_LIBELLES.get(phase.get("id"), phase.get("titre", "Étapes")))
        sections.append(f'<div class="phase phase-{phase_id}"><div class="ph">'
                        f'<span>Phase {i}</span><strong>{phase_title}</strong>'
                        f'<em>{len(phase.get("etapes", []))} jalon(s)</em>'
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

    # Une page visuelle autonome : la checklist détaillée reste ensuite disponible, mais
    # l'utilisateur peut d'abord comprendre tout son parcours en un coup d'œil.
    journey_cards = []
    for index, (phase_id, etape) in enumerate(_itinerary_steps(roadmap), 1):
        phase_label = _PHASES_LIBELLES.get(phase_id, "Étape")
        duration = (f'<span class="journey-duration">{escape(str(etape["duree"]))}</span>'
                    if etape.get("duree") else "")
        journey_cards.append(f"""
          <div class="journey-stop phase-{escape(phase_id)}">
            <div class="journey-node">{index}</div>
            <div class="journey-card">
              <div class="journey-meta">{escape(phase_label)} {duration}</div>
              <div class="journey-name">{escape(str(etape.get("titre", "")))}</div>
            </div>
          </div>""")
    journey_html = (f"""
      <section class="journey-page">
        <div class="journey-kicker">VOTRE ITINÉRAIRE FISCAL</div>
        <h2>La route vers une activité bien cadrée</h2>
        <p class="journey-intro">Chaque jalon correspond à une action concrète, détaillée dans les pages suivantes.</p>
        <div class="journey-legend"><span class="lg prep"></span>Préparer <span class="lg create"></span>Créer <span class="lg live"></span>Faire vivre</div>
        <div class="journey-track">{"".join(journey_cards)}</div>
        <div class="journey-finish">CAP ATTEINT</div>
      </section>""" if journey_cards else "")

    summary_html = (f"""
      <div class="summary-grid">
        <div class="summary-card"><span>PARCOURS</span><strong>{escape(parcours_court)}</strong></div>
        <div class="summary-card"><span>JALONS</span><strong>{len(itinerary):02d}</strong></div>
        <div class="summary-card"><span>PHASES</span><strong>{phase_count:02d}</strong></div>
      </div>""" if itinerary else "")
    first_step = itinerary[0][1] if itinerary else None
    first_action_html = (f"""
      <div class="first-action">
        <div class="first-number">01</div>
        <div><span>VOTRE PREMIER PAS</span><strong>{escape(str(first_step.get("titre", "")))}</strong>
        <p>{escape(str(first_step.get("duree") or "À démarrer dès maintenant"))}</p></div>
      </div>""" if first_step else "")
    phase_descriptions = {"preparer": "Décider", "creer": "Formaliser", "faire_vivre": "Piloter"}
    overview_items = "".join(
        f'<div class="overview-item phase-{escape(str(phase.get("id") or "preparer"))}">'
        f'<span>{index:02d}</span><div><strong>{escape(_PHASES_LIBELLES.get(phase.get("id"), phase.get("titre", "Étapes")))}</strong>'
        f'<em>{phase_descriptions.get(phase.get("id"), "Avancer")} · {len(phase.get("etapes", []))} jalon(s)</em></div></div>'
        for index, phase in enumerate(active_phases, 1))
    phase_overview_html = (f'<div class="overview"><h3>Votre parcours en {phase_count} temps</h3>'
                           f'<div class="overview-row">{overview_items}</div></div>' if overview_items else "")

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
  @page {{ size:A4; margin:16mm;
    @bottom-left {{ content:'LEDGERMIND · FEUILLE DE ROUTE'; color:#8A8A91; font-size:8px; }}
    @bottom-right {{ content:counter(page) ' / ' counter(pages); color:#8A8A91; font-size:8px; }}
  }}
  * {{ font-family:'Inter','Helvetica','Arial',sans-serif; }}
  body {{ color:#1A1A1F; }}
  .cover {{ position:relative; overflow:hidden; background:#1B3A5F; color:#FDFBF6;
            margin:-16mm -16mm 14px; padding:31px 16mm 24px; }}
  .cover:after {{ content:''; position:absolute; width:120px; height:120px; right:-34px; top:-48px;
                  border:24px solid rgba(242,217,141,.28); border-radius:50%; }}
  .cover .brand {{ font-size:14px; letter-spacing:.08em; opacity:.85; }}
  .cover h1 {{ font-size:26px; margin:6px 0 14px; }}
  .cover .pill {{ display:inline-block; background:#F2D98D; color:#8A6D1F; font-weight:700;
                  padding:5px 14px; border-radius:20px; font-size:13px; }}
  .cover .meta {{ margin-top:14px; font-size:12.5px; opacity:.92; }}
  .summary-grid {{ display:flex; gap:9px; margin:0 0 12px; }}
  .summary-card {{ flex:1; background:#FDFBF6; border:1px solid #E8E3D9; border-radius:11px;
                   padding:9px 11px; box-shadow:0 2px 8px rgba(27,58,95,.07); }}
  .summary-card span {{ display:block; color:#6B6B75; font-size:8px; font-weight:700; letter-spacing:.13em; }}
  .summary-card strong {{ display:block; color:#1B3A5F; font-size:16px; margin-top:3px; }}
  .first-action {{ display:flex; align-items:center; gap:11px; margin:12px 0 15px; padding:11px 13px;
                   background:#FBF3DC; border:1px solid #F2D98D; border-radius:12px; }}
  .first-number {{ width:31px; height:31px; line-height:31px; flex:0 0 31px; text-align:center;
                   border-radius:50%; background:#1B3A5F; color:#FDFBF6; font-size:10px; font-weight:700; }}
  .first-action span {{ display:block; color:#8A6D1F; font-size:8px; font-weight:700; letter-spacing:.12em; }}
  .first-action strong {{ display:block; color:#1A1A1F; font-size:12.5px; margin-top:2px; }}
  .first-action p {{ color:#6B6B75; font-size:9.5px; margin:2px 0 0; }}
  .overview {{ margin:13px 0 4px; }}
  .overview h3 {{ color:#1B3A5F; font-size:11px; margin:0 0 7px; }}
  .overview-row {{ display:flex; gap:7px; }}
  .overview-item {{ flex:1; display:flex; align-items:center; gap:7px; border:1px solid #E8E3D9;
                    border-top:3px solid #F2D98D; border-radius:9px; padding:7px; background:#FDFBF6; }}
  .overview-item > span {{ color:#8A6D1F; font-size:8px; font-weight:700; }}
  .overview-item strong {{ display:block; color:#1A1A1F; font-size:9.5px; }}
  .overview-item em {{ display:block; color:#6B6B75; font-size:7.5px; font-style:normal; margin-top:2px; }}
  .overview-item.phase-creer {{ border-top-color:#2E5C8A; }}
  .overview-item.phase-creer > span {{ color:#2E5C8A; }}
  .overview-item.phase-faire_vivre {{ border-top-color:#7A4A63; }}
  .overview-item.phase-faire_vivre > span {{ color:#7A4A63; }}
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
  .journey-page {{ page-break-before:always; page-break-after:always; position:relative;
                   min-height:248mm; padding:2mm 5mm 0; overflow:hidden; }}
  .journey-page:before {{ content:''; position:absolute; width:76mm; height:76mm; border:15mm solid #EDF2F8;
                          border-radius:50%; right:-48mm; top:-40mm; }}
  .journey-kicker {{ color:#2E5C8A; font-size:10px; font-weight:700; letter-spacing:.18em; margin-top:2mm; }}
  .journey-page h2 {{ color:#1B3A5F; font-size:22px; margin:3px 0 4px; }}
  .journey-intro {{ color:#6B6B75; font-size:11px; margin:0 0 7px; }}
  .journey-legend {{ font-size:9px; color:#6B6B75; margin-bottom:5px; }}
  .lg {{ display:inline-block; width:7px; height:7px; border-radius:50%; margin:0 4px 0 10px; }}
  .lg:first-child {{ margin-left:0; }}
  .lg.prep {{ background:#F2D98D; }} .lg.create {{ background:#2E5C8A; }} .lg.live {{ background:#7A4A63; }}
  .journey-track {{ position:relative; padding:4px 0 4px 44px; }}
  .journey-track:before {{ content:''; position:absolute; left:17px; top:4px; bottom:4px; width:22px;
                           border-radius:14px; background:#1B3A5F; box-shadow:0 0 0 4px #D8E2EC; }}
  .journey-track:after {{ content:''; position:absolute; left:27px; top:10px; bottom:10px;
                          border-left:2px dashed #FDFBF6; }}
  .journey-stop {{ position:relative; min-height:19mm; display:flex; align-items:center; }}
  .journey-stop:nth-child(even) .journey-card {{ margin-left:12mm; }}
  .journey-node {{ position:absolute; z-index:2; left:-35px; top:7mm; width:18px; height:18px; line-height:18px;
                   border:3px solid #FDFBF6; border-radius:50%; background:#F2D98D; color:#8A6D1F;
                   font-size:9px; font-weight:700; text-align:center; }}
  .phase-creer .journey-node {{ background:#2E5C8A; color:#FDFBF6; }}
  .phase-faire_vivre .journey-node {{ background:#7A4A63; color:#FDFBF6; }}
  .journey-card {{ width:118mm; border:1px solid #E8E3D9; border-radius:10px; background:#FDFBF6;
                   padding:7px 10px; box-shadow:0 2px 7px rgba(27,58,95,.09); }}
  .journey-meta {{ color:#2E5C8A; font-size:8px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }}
  .journey-duration {{ float:right; color:#6B6B75; font-weight:400; letter-spacing:0; text-transform:none; }}
  .journey-name {{ color:#1A1A1F; font-size:11px; font-weight:600; margin-top:3px; }}
  .journey-finish {{ display:inline-block; margin:5px 0 0 5px; padding:5px 10px; border-radius:12px;
                     background:#7A4A63; color:#FDFBF6; font-size:8px; font-weight:700; letter-spacing:.12em; }}
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
  .ph {{ display:flex; align-items:center; gap:9px; background:#1B3A5F; color:#FDFBF6;
         padding:8px 12px; border-radius:9px; margin-bottom:10px; }}
  .ph span {{ font-size:8px; font-weight:700; opacity:.72; text-transform:uppercase; letter-spacing:.1em; }}
  .ph strong {{ font-size:13px; }} .ph em {{ margin-left:auto; font-size:8px; font-style:normal; opacity:.76; }}
  .phase-preparer .ph {{ background:#F2D98D; color:#8A6D1F; }}
  .phase-faire_vivre .ph {{ background:#7A4A63; color:#FDFBF6; }}
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
  {summary_html}
  <div class="regime"><strong>Votre situation.</strong> {escape(bandeau.get('texte',''))}</div>
  {dur_html}
  {''.join(barre(s) for s in seuils[:3])}
  {cmp_html}
  {first_action_html}
  {phase_overview_html}
  {journey_html}
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

    class RoadmapPDF(FPDF):
        def footer(self):
            self.set_y(-10)
            self.set_font("helvetica", "", 7)
            self.set_text_color(*MUTED)
            self.cell(0, 5, f"LEDGERMIND - FEUILLE DE ROUTE     {self.page_no()}/{{nb}}", align="R")

    profil = roadmap.get("profil", {})
    bandeau = roadmap.get("bandeau", {})
    seuils = roadmap.get("seuils_profil", [])
    activite = str(profil.get("activite", "création de contenu"))
    ca = profil.get("ca_estime_annuel") or profil.get("ca_estime") or 0
    itinerary = _itinerary_steps(roadmap)
    active_phases = [phase for phase in _phases(roadmap) if phase.get("etapes")]

    pdf = RoadmapPDF(format="A4")
    pdf.alias_nb_pages()
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
    # Motif circulaire et mini-route : un rappel discret de l'identité visuelle de la roadmap.
    color(pdf.set_fill_color, (65, 90, 121))
    pdf.ellipse(pdf.w - 47, -23, 58, 58, style="F")
    color(pdf.set_fill_color, BUTTER)
    pdf.ellipse(pdf.w - 27, -15, 35, 35, style="F")
    color(pdf.set_draw_color, (113, 140, 170))
    pdf.set_line_width(6)
    pdf.line(pdf.w - 62, 43, pdf.w - 43, 35)
    pdf.line(pdf.w - 43, 35, pdf.w - 24, 45)
    color(pdf.set_draw_color, CREME)
    pdf.set_line_width(1)
    pdf.line(pdf.w - 62, 43, pdf.w - 43, 35)
    pdf.line(pdf.w - 43, 35, pdf.w - 24, 45)
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

    # Trois chiffres suffisent pour comprendre le document avant de lire le détail.
    if itinerary:
        summary_y = pdf.get_y()
        card_gap = 4
        card_w = (CW - 2 * card_gap) / 3
        short_path = {"micro": "Micro", "societe": "Société", "bascule": "Arbitrage"}.get(
            roadmap.get("parcours"), "Personnalisé")
        cards = (("PARCOURS", short_path), ("JALONS", f"{len(itinerary):02d}"),
                 ("PHASES", f"{len(active_phases):02d}"))
        for index, (card_label, card_value) in enumerate(cards):
            card_x = L + index * (card_w + card_gap)
            color(pdf.set_fill_color, CREME)
            color(pdf.set_draw_color, BORDER)
            pdf.rect(card_x, summary_y, card_w, 18, style="DF")
            pdf.set_xy(card_x + 3, summary_y + 2.5)
            pdf.set_font(fam, "B", 6.5)
            color(pdf.set_text_color, MUTED)
            pdf.cell(card_w - 6, 3.5, s(card_label))
            pdf.set_xy(card_x + 3, summary_y + 7)
            pdf.set_font(fam, "B", 12)
            color(pdf.set_text_color, NAVY)
            pdf.cell(card_w - 6, 7, s(card_value))
        pdf.set_y(summary_y + 22)

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

    # ---------- Première action : le document donne immédiatement un point de départ ----------
    if itinerary:
        first_step = itinerary[0][1]
        if pdf.get_y() > pdf.h - pdf.b_margin - 27:
            pdf.add_page()
        action_y = pdf.get_y() + 2
        color(pdf.set_fill_color, BUTTER_BG)
        color(pdf.set_draw_color, BUTTER)
        pdf.rect(L, action_y, CW, 22, style="DF")
        color(pdf.set_fill_color, NAVY)
        pdf.ellipse(L + 5, action_y + 4.5, 13, 13, style="F")
        pdf.set_xy(L + 5, action_y + 7.5)
        pdf.set_font(fam, "B", 8)
        color(pdf.set_text_color, CREME)
        pdf.cell(13, 7, "01", align="C")
        pdf.set_xy(L + 23, action_y + 3)
        pdf.set_font(fam, "B", 6.5)
        color(pdf.set_text_color, BUTTER_INK)
        pdf.cell(CW - 28, 4, s("VOTRE PREMIER PAS"))
        pdf.set_xy(L + 23, action_y + 7.5)
        pdf.set_font(fam, "B", 9)
        color(pdf.set_text_color, INK)
        first_title = str(first_step.get("titre", ""))
        if len(first_title) > 82:
            first_title = first_title[:79].rstrip() + "…"
        pdf.cell(CW - 28, 5, s(first_title))
        pdf.set_xy(L + 23, action_y + 13)
        pdf.set_font(fam, "", 7.5)
        color(pdf.set_text_color, MUTED)
        pdf.cell(CW - 28, 4, s(first_step.get("duree") or "À démarrer dès maintenant"))
        pdf.set_y(action_y + 26)

        # Vue en trois temps : un sommaire visuel très court avant la carte complète.
        if active_phases:
            overview_y = pdf.get_y() + 1
            pdf.set_xy(L, overview_y)
            pdf.set_font(fam, "B", 9)
            color(pdf.set_text_color, NAVY)
            pdf.cell(CW, 5, s(f"Votre parcours en {len(active_phases)} temps"))
            overview_y += 7
            overview_gap = 4
            overview_w = (CW - overview_gap * (len(active_phases) - 1)) / len(active_phases)
            phase_descriptions = {"preparer": "Décider", "creer": "Formaliser", "faire_vivre": "Piloter"}
            overview_colors = {"preparer": (BUTTER, BUTTER_INK), "creer": (NAVY2, NAVY),
                               "faire_vivre": (PLUM, PLUM_INK)}
            for index, phase in enumerate(active_phases, 1):
                phase_id = phase.get("id") or "preparer"
                marker, phase_ink = overview_colors.get(phase_id, (NAVY2, NAVY))
                item_x = L + (index - 1) * (overview_w + overview_gap)
                color(pdf.set_fill_color, CREME)
                color(pdf.set_draw_color, BORDER)
                pdf.rect(item_x, overview_y, overview_w, 16, style="DF")
                color(pdf.set_fill_color, marker)
                pdf.rect(item_x, overview_y, overview_w, 1.5, style="F")
                pdf.set_xy(item_x + 3, overview_y + 3)
                pdf.set_font(fam, "B", 6.5)
                color(pdf.set_text_color, phase_ink)
                pdf.cell(7, 4, f"{index:02d}")
                pdf.set_font(fam, "B", 8)
                color(pdf.set_text_color, INK)
                phase_title = _PHASES_LIBELLES.get(phase_id, phase.get("titre", "Étapes"))
                pdf.cell(overview_w - 13, 4, s(phase_title))
                pdf.set_xy(item_x + 10, overview_y + 8)
                pdf.set_font(fam, "", 6.5)
                color(pdf.set_text_color, MUTED)
                pdf.cell(overview_w - 13, 4, s(
                    f"{phase_descriptions.get(phase_id, 'Avancer')} · {len(phase.get('etapes', []))} jalon(s)"))
            pdf.set_y(overview_y + 20)

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

    # ---------- Page panoramique de l'itinéraire ----------
    if itinerary:
        pdf.add_page()
        color(pdf.set_text_color, NAVY2)
        pdf.set_xy(L, 14)
        pdf.set_font(fam, "B", 9)
        pdf.cell(CW, 5, s("VOTRE ITINÉRAIRE FISCAL"))
        pdf.set_xy(L, 21)
        color(pdf.set_text_color, NAVY)
        pdf.set_font(fam, "B", 19)
        pdf.cell(CW, 9, s("La route vers une activité bien cadrée"))
        pdf.set_xy(L, 32)
        color(pdf.set_text_color, MUTED)
        pdf.set_font(fam, "", 8.5)
        pdf.cell(CW, 5, s("Chaque jalon est détaillé dans les pages suivantes."))

        count = len(itinerary)
        start_y, end_y = 51.0, 263.0
        gap = (end_y - start_y) / max(1, count - 1)
        road_points = [
            (pdf.w / 2 + (-9 if index % 2 == 0 else 9), start_y + index * gap)
            for index in range(count)
        ]

        # Route sinueuse, bord clair puis chaussée marine et ligne centrale.
        color(pdf.set_draw_color, (216, 226, 236))
        pdf.set_line_width(17)
        for point_a, point_b in zip(road_points, road_points[1:]):
            pdf.line(point_a[0], point_a[1], point_b[0], point_b[1])
        color(pdf.set_draw_color, NAVY)
        pdf.set_line_width(13)
        for point_a, point_b in zip(road_points, road_points[1:]):
            pdf.line(point_a[0], point_a[1], point_b[0], point_b[1])
        color(pdf.set_draw_color, CREME)
        pdf.set_line_width(1.2)
        try:
            pdf.set_dash_pattern(dash=2.5, gap=2.8)
            for point_a, point_b in zip(road_points, road_points[1:]):
                pdf.line(point_a[0], point_a[1], point_b[0], point_b[1])
            pdf.set_dash_pattern()
        except (AttributeError, TypeError):
            for point_a, point_b in zip(road_points, road_points[1:]):
                pdf.line(point_a[0], point_a[1], point_b[0], point_b[1])

        phase_colors = {
            "preparer": (BUTTER, BUTTER_BG, BUTTER_INK),
            "creer": (NAVY2, NAVY_BG, NAVY),
            "faire_vivre": (PLUM, PLUM_BG, PLUM_INK),
        }
        card_w, card_h = 70.0, min(18.0, max(14.0, gap - 3.0))
        for index, ((phase_id, etape), (road_x, road_y)) in enumerate(zip(itinerary, road_points), 1):
            marker, card_bg, card_ink = phase_colors.get(phase_id, phase_colors["preparer"])
            left_side = index % 2 == 1
            card_x = L if left_side else R - card_w
            card_y = road_y - card_h / 2
            connector_end = card_x + card_w if left_side else card_x

            color(pdf.set_draw_color, marker)
            pdf.set_line_width(1.2)
            pdf.line(connector_end, road_y, road_x, road_y)
            color(pdf.set_fill_color, card_bg)
            color(pdf.set_draw_color, BORDER)
            pdf.rect(card_x, card_y, card_w, card_h, style="DF")

            phase_label = _PHASES_LIBELLES.get(phase_id, "Étape")
            pdf.set_xy(card_x + 3, card_y + 2)
            pdf.set_font(fam, "B", 6.5)
            color(pdf.set_text_color, card_ink)
            duration = f"  ·  {etape.get('duree')}" if etape.get("duree") else ""
            pdf.cell(card_w - 6, 3.5, s(phase_label + duration))
            title = str(etape.get("titre", ""))
            if len(title) > 70:
                title = title[:67].rstrip() + "…"
            pdf.set_xy(card_x + 3, card_y + 6)
            pdf.set_font(fam, "B", 7.4)
            color(pdf.set_text_color, INK)
            pdf.multi_cell(card_w - 6, 3.6, s(title), align="L")

            color(pdf.set_fill_color, marker)
            color(pdf.set_draw_color, CREME)
            pdf.ellipse(road_x - 4.2, road_y - 4.2, 8.4, 8.4, style="DF")
            pdf.set_xy(road_x - 4.2, road_y - 2.8)
            pdf.set_font(fam, "B", 7.5)
            color(pdf.set_text_color, CREME if phase_id != "preparer" else BUTTER_INK)
            pdf.cell(8.4, 5.6, s(index), align="C")

        # Départ et arrivée donnent au tracé un sens immédiat.
        color(pdf.set_fill_color, BUTTER)
        color(pdf.set_text_color, BUTTER_INK)
        pdf.set_xy(road_points[0][0] - 12, 41)
        pdf.set_font(fam, "B", 7)
        pdf.cell(24, 6, s("DÉPART"), align="C", fill=True)
        color(pdf.set_fill_color, PLUM)
        color(pdf.set_text_color, CREME)
        pdf.set_xy(R - 24, 270)
        pdf.cell(24, 6, s("CAP ATTEINT"), align="C", fill=True)

        # La checklist détaillée commence sur une nouvelle page propre.
        pdf.set_line_width(0.2)
        pdf.add_page()

    # ---------- Phases + étapes ----------
    n = 0
    for i, phase in enumerate(_phases(roadmap), 1):
        if pdf.get_y() > pdf.h - pdf.b_margin - 30:
            pdf.add_page()
        # Bandeau de phase : chaque couleur devient un repère stable dans tout le document.
        phase_id = phase.get("id") or "preparer"
        phase_fill, phase_text, phase_soft, phase_ink = {
            "preparer": (BUTTER, BUTTER_INK, BUTTER_BG, BUTTER_INK),
            "creer": (NAVY, CREME, NAVY_BG, NAVY),
            "faire_vivre": (PLUM, CREME, PLUM_BG, PLUM_INK),
        }.get(phase_id, (NAVY, CREME, NAVY_BG, NAVY))
        pdf.ln(2)
        py = pdf.get_y()
        color(pdf.set_fill_color, phase_fill)
        pdf.rect(L, py, CW, 8, style="F")
        pdf.set_xy(L + 3, py + 1)
        pdf.set_font(fam, "B", 11)
        color(pdf.set_text_color, phase_text)
        titre_phase = _PHASES_LIBELLES.get(phase.get("id"), phase.get("titre", "Étapes"))
        pdf.cell(CW - 32, 6, s(f"Phase {i} — {titre_phase}"))
        pdf.set_font(fam, "", 7.5)
        pdf.cell(29, 6, s(f"{len(phase.get('etapes', []))} jalon(s)"), align="R")
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
            color(pdf.set_fill_color, phase_soft)
            pdf.rect(inner_l + 7, box_y0 + 1, 7, 7, style="F")
            pdf.set_xy(inner_l + 7, box_y0 + 1.6)
            pdf.set_font(fam, "B", 10)
            color(pdf.set_text_color, phase_ink)
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
            color(pdf.set_fill_color, phase_fill)
            pdf.rect(L, box_y0 - 2, 1.8, (box_y1 - box_y0) + 5, style="F")
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
