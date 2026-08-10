/**
 * Étiquettes de transparence IA — article 50 du règlement (UE) 2024/1689.
 *
 * Trois composants, pour trois situations distinctes que la réglementation ne traite pas
 * de la même façon :
 *
 *   • `AiLabel`       — étiquette au fil du contenu (une réponse, un rapport, un bloc).
 *   • `AiChatNotice`  — divulgation de premier contact d'un agent conversationnel, art. 50(1).
 *   • `AiVisual`      — image générée, avec son étiquette incrustée dans le cadre.
 *
 * Contraintes tenues ici, reprises du guide :
 *   – perceptible dès la première exposition, jamais derrière un clic ou un chargement différé ;
 *   – jamais recouvrable : aucune étiquette n'est posée sous un z-index qu'une modale,
 *     un bandeau cookies ou une notification pourrait franchir ;
 *   – taille lisible : le pictogramme n'est jamais réduit au point de passer pour un ornement ;
 *   – annoncée aux technologies d'assistance ;
 *   – le second niveau d'information (le « pourquoi ») est atteignable au clavier.
 *
 * Ce que ces composants ne remplacent pas : ils vivent dans le DOM, donc ils disparaissent
 * à l'export. Le marquage qui part avec le fichier est posé par le backend.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  DIVULGATION_CHAT,
  MARQUAGES,
  MENTION_VISUEL,
  PICTOGRAMME,
  REGLEMENT,
  type NiveauIA,
} from "@/lib/ai-act";

type Taille = "sm" | "md";

/** 16 px au minimum : en dessous, le pictogramme cesse d'être identifiable. */
const TAILLES: Record<Taille, { icone: string; texte: string; padding: string }> = {
  sm: { icone: "h-4", texte: "text-[11px]", padding: "px-2 py-0.5" },
  md: { icone: "h-5", texte: "text-xs", padding: "px-2.5 py-1" },
};

/**
 * Étiquette « Généré par IA » à poser au contact du contenu concerné.
 *
 * `detail` ouvre le second niveau : un bouton (donc focusable et actionnable au clavier)
 * qui déplie l'explication complète. Sans lui, l'étiquette reste un simple texte — c'est
 * le bon choix quand elle est répétée à chaque message et qu'un bouton par message
 * encombrerait la navigation au clavier.
 */
export function AiLabel({
  niveau = "genere",
  taille = "md",
  detail = false,
  className,
}: {
  niveau?: NiveauIA;
  taille?: Taille;
  detail?: boolean;
  className?: string;
}) {
  const marquage = MARQUAGES[niveau];
  const dim = TAILLES[taille];
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!ouvert) return;
    const auClicExterieur = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOuvert(false);
    };
    const aEchap = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    document.addEventListener("mousedown", auClicExterieur);
    document.addEventListener("keydown", aEchap);
    return () => {
      document.removeEventListener("mousedown", auClicExterieur);
      document.removeEventListener("keydown", aEchap);
    };
  }, [ouvert]);

  const badge = (
    <>
      <img
        src={PICTOGRAMME}
        alt=""
        aria-hidden
        draggable={false}
        className={cn(dim.icone, "w-auto select-none")}
      />
      <span className="sr-only">{marquage.alt}. </span>
      <span aria-hidden className={cn(dim.texte, "font-semibold tracking-tight")}>
        {marquage.libelleCourt}
      </span>
    </>
  );

  const habillage = cn(
    "inline-flex items-center gap-1.5 rounded-full border border-border bg-card/90",
    dim.padding,
    "text-foreground",
    className,
  );

  if (!detail) {
    return (
      // role="note" plutôt qu'un simple <span> : la mention est une information sur le
      // contenu voisin, pas une partie de ce contenu.
      <span role="note" className={habillage}>
        {badge}
      </span>
    );
  }

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        aria-label={`${marquage.alt} — en savoir plus`}
        className={cn(habillage, "transition-colors hover:border-ink focus-visible:border-ink")}
      >
        {badge}
        <span aria-hidden className={cn(dim.texte, "text-muted-foreground")}>
          ⓘ
        </span>
      </button>

      {ouvert && (
        <span
          role="dialog"
          aria-label="À propos de ce contenu généré par IA"
          // z-[110] : au-dessus du grain-overlay de la racine (z-[100]) et des surfaces de
          // l'application. L'exigence « aucun élément ne doit recouvrir l'étiquette » vaut
          // aussi pour son panneau d'explication.
          className="absolute z-[110] top-full left-0 mt-2 w-80 rounded-2xl border border-border bg-card p-4 text-left shadow-xl animate-slide-up"
        >
          <span className="rule-label mb-2 block text-teal-dark">{marquage.libelleCourt}</span>
          <span className="block text-xs leading-relaxed text-muted-foreground">
            {marquage.libelleLong}
          </span>
          <span className="mt-3 block text-[10px] uppercase tracking-wider text-muted-foreground">
            {REGLEMENT}
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * Divulgation de premier contact d'un agent conversationnel (art. 50(1)).
 *
 * Placée au-dessus du fil, avant le premier message : « au premier point de contact » est
 * la formulation du texte, et le guide précise qu'une mention enfouie dans des CGU ne
 * satisfait pas l'obligation.
 *
 * Non refermable, volontairement. L'exigence porte sur l'exposition initiale ; un bouton
 * de fermeture invite à faire disparaître l'information avant de l'avoir lue, et rien
 * n'oblige à la reproposer ensuite.
 */
export function AiChatNotice({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      role="note"
      aria-label="Information sur la nature du service"
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-border bg-muted/40",
        compact ? "px-3 py-2" : "px-4 py-3",
        className,
      )}
    >
      <img
        src={PICTOGRAMME}
        alt=""
        aria-hidden
        draggable={false}
        className={cn(compact ? "h-4" : "h-5", "w-auto shrink-0 select-none")}
      />
      <p
        className={cn(
          "leading-relaxed text-muted-foreground",
          compact ? "text-[11px]" : "text-xs",
        )}
      >
        {DIVULGATION_CHAT}
      </p>
    </div>
  );
}

/**
 * Étiquette seule, à poser dans le cadre d'un média qu'on ne peut pas envelopper.
 *
 * Les visuels de fond du produit (panneau de connexion, vidéo du héros) sont positionnés
 * en `absolute inset-0` : les entourer d'un conteneur casserait leur mise en page.
 * L'appelant place donc l'étiquette lui-même dans le cadre positionné le plus proche —
 * `AiVisual` reste préférable partout où l'enveloppe est possible.
 *
 * Contraste garanti : fond sombre opaque et texte blanc, quelles que soient les couleurs
 * du média en dessous.
 */
export function AiMediaBadge({
  niveau = "genere",
  className,
}: {
  niveau?: NiveauIA;
  className?: string;
}) {
  const marquage = MARQUAGES[niveau];
  return (
    <span
      role="note"
      className={cn(
        "pointer-events-none inline-flex items-center gap-1 rounded-full",
        "bg-black/75 px-2 py-0.5 backdrop-blur-[2px]",
        className,
      )}
    >
      <img src={PICTOGRAMME} alt="" aria-hidden draggable={false} className="h-3.5 w-auto select-none" />
      <span className="sr-only">{marquage.alt}</span>
      <span aria-hidden className="text-[10px] font-semibold tracking-tight text-white">
        {MENTION_VISUEL}
      </span>
    </span>
  );
}

/**
 * Image générée par IA, avec son étiquette incrustée dans le cadre.
 *
 * L'étiquette est posée SUR le visuel, pas à côté : à côté, un recadrage, une capture ou
 * une reprise de l'image la laisse derrière. C'est le minimum tenable côté interface —
 * seule une incrustation dans le fichier lui-même survit à un téléchargement, ce que
 * `backend/app/core/ai_act.py` fait pour les documents.
 *
 * `decoratif` couvre le cas des visuels d'ambiance : l'image est masquée aux lecteurs
 * d'écran, mais l'étiquette, elle, reste annoncée — sans quoi l'information ne parviendrait
 * jamais à un utilisateur non-voyant.
 */
export function AiVisual({
  src,
  alt,
  niveau = "genere",
  decoratif = false,
  position = "bottom-right",
  className,
  imgClassName,
  children,
}: {
  src?: string;
  alt?: string;
  niveau?: NiveauIA;
  decoratif?: boolean;
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  className?: string;
  imgClassName?: string;
  /** Média déjà composé (vidéo, <picture>…) à envelopper au lieu d'un <img>. */
  children?: React.ReactNode;
}) {
  const marquage = MARQUAGES[niveau];
  const coins = {
    "bottom-right": "bottom-2 right-2",
    "bottom-left": "bottom-2 left-2",
    "top-right": "top-2 right-2",
    "top-left": "top-2 left-2",
  }[position];

  return (
    <span className={cn("relative inline-block overflow-hidden", className)}>
      {children ?? (
        <img
          src={src}
          alt={decoratif ? "" : (alt ?? marquage.alt)}
          aria-hidden={decoratif || undefined}
          draggable={false}
          className={imgClassName}
        />
      )}
      <span
        role="note"
        // z-10 suffit : l'étiquette n'a besoin de dominer que le média qu'elle habille,
        // et rien de l'application ne se glisse à l'intérieur de ce cadre.
        className={cn(
          "pointer-events-none absolute z-10 inline-flex items-center gap-1 rounded-full",
          "bg-black/75 px-2 py-0.5 backdrop-blur-[2px]",
          coins,
        )}
      >
        <img
          src={PICTOGRAMME}
          alt=""
          aria-hidden
          draggable={false}
          className="h-3.5 w-auto select-none"
        />
        <span className="sr-only">{marquage.alt}</span>
        <span aria-hidden className="text-[10px] font-semibold tracking-tight text-white">
          {MENTION_VISUEL}
        </span>
      </span>
    </span>
  );
}
