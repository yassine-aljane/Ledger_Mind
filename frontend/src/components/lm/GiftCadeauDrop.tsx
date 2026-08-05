/**
 * Cadeau / dotation — scène chat + cube (import photo uniquement).
 * `variant="panel"` : dans la carte Déposer (onglet).
 */

import { ImagePlus } from "lucide-react";
import { useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

type Props = {
  onFiles: (files: FileList | File[]) => void;
  className?: string;
  /** panel = dans la carte Déposer (onglet) ; rail = bandeau ; default = standalone */
  variant?: "default" | "rail" | "panel";
  /** Désactive le clic pendant une analyse en cours. */
  disabled?: boolean;
};

const SPARKS = [
  { x: "18%", y: "22%", d: "0s", s: 2 },
  { x: "78%", y: "18%", d: "0.12s", s: 2 },
  { x: "12%", y: "55%", d: "0.22s", s: 2 },
  { x: "86%", y: "48%", d: "0.08s", s: 2 },
];

export function GiftCadeauDrop({
  onFiles,
  className,
  variant = "default",
  disabled = false,
}: Props) {
  const rail = variant === "rail";
  const panel = variant === "panel";
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const reveal = hover;

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    if (rail) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: py * -10, y: px * 14 });
  }

  function resetTilt() {
    setTilt({ x: 0, y: 0 });
  }

  function openPicker() {
    if (disabled) return;
    fileRef.current?.click();
  }

  const sceneTilt: CSSProperties = {
    ["--tilt-x" as string]: `${tilt.x}deg`,
    ["--tilt-y" as string]: `${tilt.y}deg`,
  };

  return (
    <div className={cn("relative", className)}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        disabled={disabled}
        className={cn(
          "lm-gift-portal group relative block w-full overflow-hidden text-left",
          rail && "lm-gift-portal--rail",
          panel && "lm-gift-portal--panel",
          reveal && "lm-gift-portal--open",
          disabled && "pointer-events-none opacity-70",
        )}
        style={sceneTilt}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => {
          setHover(false);
          resetTilt();
        }}
        onPointerMove={onPointerMove}
        onFocus={() => setHover(true)}
        onBlur={() => {
          setHover(false);
          resetTilt();
        }}
        onClick={openPicker}
        aria-controls={`${uid}-hint`}
        aria-label="Importer une photo du cadeau ou de la dotation"
      >
        {reveal &&
          !rail &&
          SPARKS.map((s, i) => (
            <span
              key={i}
              className="lm-gift-spark"
              style={
                {
                  left: s.x,
                  top: s.y,
                  width: s.s,
                  height: s.s,
                  animationDelay: s.d,
                } as CSSProperties
              }
              aria-hidden
            />
          ))}

        {rail ? (
          <div className="relative z-10 flex items-center gap-4 px-4 py-3.5 sm:gap-5 sm:px-5">
            <div className={cn("lm-gift-stage lm-gift-stage--rail", reveal && "lm-gift-stage--open")}>
              <div className={cn("lm-gift-cat", reveal ? "lm-gift-cat--out" : "lm-gift-cat--in")} aria-hidden>
                <img
                  src="/gifts/sitting-cat.original.gif"
                  alt=""
                  className="lm-gift-cat__gif"
                  width={896}
                  height={896}
                  draggable={false}
                />
              </div>
              <div className={cn("lm-gift-cube", reveal && "lm-gift-cube--open")} aria-hidden>
                <div className="lm-gift-cube__scene">
                  <div className="lm-gift-cube__lid">
                    <span className="lm-gift-cube__face lm-gift-cube__face--lid-top">
                      <span className="lm-gift-cube__bow">
                        <i />
                        <i />
                        <b />
                      </span>
                      <span className="lm-gift-cube__top-seal">LM</span>
                      <span className="lm-gift-cube__ribbon-v lm-gift-cube__ribbon-v--lid" />
                      <span className="lm-gift-cube__ribbon-h lm-gift-cube__ribbon-h--lid" />
                    </span>
                    <span className="lm-gift-cube__face lm-gift-cube__face--lid-front" />
                    <span className="lm-gift-cube__face lm-gift-cube__face--lid-back" />
                    <span className="lm-gift-cube__face lm-gift-cube__face--lid-left" />
                    <span className="lm-gift-cube__face lm-gift-cube__face--lid-right" />
                  </div>
                  <div className="lm-gift-cube__box">
                    <span className="lm-gift-cube__face lm-gift-cube__face--front">
                      <span className="lm-gift-cube__ribbon-v" />
                      <span className="lm-gift-cube__ribbon-h" />
                      <span className="lm-gift-cube__seal">LM</span>
                    </span>
                    <span className="lm-gift-cube__face lm-gift-cube__face--back" />
                    <span className="lm-gift-cube__face lm-gift-cube__face--left" />
                    <span className="lm-gift-cube__face lm-gift-cube__face--right" />
                    <span className="lm-gift-cube__face lm-gift-cube__face--bottom" />
                    <span className="lm-gift-cube__tissue" />
                  </div>
                </div>
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-foreground">Cadeau / dotation</p>
              <p className="mt-0.5 text-xs leading-snug text-ink-foreground/55">
                {reveal ? "Cliquez pour importer une photo" : "Produit reçu, nature · art. 82 CGI"}
              </p>
            </div>

            <span className="hidden shrink-0 sm:inline">
              <ImagePlus className="size-4 text-ink-foreground/40" aria-hidden />
            </span>
          </div>
        ) : (
          <div
            className={cn(
              "relative z-10 flex flex-col items-center justify-end px-5 pb-8 pt-8",
              panel ? "min-h-64 sm:min-h-72" : "min-h-72 sm:min-h-80",
            )}
          >
            <div className={cn("lm-gift-cat", reveal ? "lm-gift-cat--out" : "lm-gift-cat--in")} aria-hidden>
              <img
                src="/gifts/sitting-cat.original.gif"
                alt=""
                className="lm-gift-cat__gif"
                width={896}
                height={896}
                draggable={false}
              />
            </div>
            <div className={cn("lm-gift-stage", reveal && "lm-gift-stage--open")}>
              <div className={cn("lm-gift-cube", reveal && "lm-gift-cube--open")} aria-hidden>
                <div className="lm-gift-cube__scene">
                  <div className="lm-gift-cube__lid">
                    <span className="lm-gift-cube__face lm-gift-cube__face--lid-top">
                      <span className="lm-gift-cube__bow">
                        <i />
                        <i />
                        <b />
                      </span>
                      <span className="lm-gift-cube__top-seal">LM</span>
                      <span className="lm-gift-cube__ribbon-v lm-gift-cube__ribbon-v--lid" />
                      <span className="lm-gift-cube__ribbon-h lm-gift-cube__ribbon-h--lid" />
                    </span>
                    <span className="lm-gift-cube__face lm-gift-cube__face--lid-front" />
                    <span className="lm-gift-cube__face lm-gift-cube__face--lid-back" />
                    <span className="lm-gift-cube__face lm-gift-cube__face--lid-left" />
                    <span className="lm-gift-cube__face lm-gift-cube__face--lid-right" />
                  </div>
                  <div className="lm-gift-cube__box">
                    <span className="lm-gift-cube__face lm-gift-cube__face--front">
                      <span className="lm-gift-cube__ribbon-v" />
                      <span className="lm-gift-cube__ribbon-h" />
                      <span className="lm-gift-cube__seal">LM</span>
                    </span>
                    <span className="lm-gift-cube__face lm-gift-cube__face--back" />
                    <span className="lm-gift-cube__face lm-gift-cube__face--left" />
                    <span className="lm-gift-cube__face lm-gift-cube__face--right" />
                    <span className="lm-gift-cube__face lm-gift-cube__face--bottom" />
                    <span className="lm-gift-cube__tissue" />
                  </div>
                </div>
                <div className="lm-gift-cube__shadow" />
              </div>
            </div>
            <div id={`${uid}-hint`} className="relative z-20 mt-6 max-w-xs text-center">
              <p className="lm-gift-copy font-display text-xl text-ink-foreground">
                {reveal ? "Importez une photo" : "Un cadeau à déclarer ?"}
              </p>
              <p className="mt-1.5 text-xs text-ink-foreground/55">
                {reveal ? "Cliquez pour choisir une image" : "Survolez le carton"}
              </p>
            </div>
          </div>
        )}
      </button>
    </div>
  );
}
