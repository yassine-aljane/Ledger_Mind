/**
 * Cadeau / dotation — scène chat + cube.
 * `variant="rail"` : bandeau intégré sous la zone documents (page cohérente).
 */

import { Camera, ImagePlus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  onFiles: (files: FileList | File[]) => void;
  className?: string;
  /** panel = dans la carte Déposer (onglet) ; rail = bandeau ; default = standalone */
  variant?: "default" | "rail" | "panel";
};

const SPARKS = [
  { x: "18%", y: "22%", d: "0s", s: 2 },
  { x: "78%", y: "18%", d: "0.12s", s: 2 },
  { x: "12%", y: "55%", d: "0.22s", s: 2 },
  { x: "86%", y: "48%", d: "0.08s", s: 2 },
];

export function GiftCadeauDrop({ onFiles, className, variant = "default" }: Props) {
  const rail = variant === "rail";
  const panel = variant === "panel";
  const embedded = rail || panel;
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const streamRef = useRef<MediaStream | null>(null);

  const reveal = hover || menuOpen;

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setHover(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

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

  async function openCamera() {
    setMenuOpen(false);
    setCamError(null);
    if (/Mobi|Android/i.test(navigator.userAgent)) {
      cameraRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setCamOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setCamError("Caméra indisponible — importez une photo à la place.");
      cameraRef.current?.click();
    }
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOpen(false);
  }

  function snapPhoto() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `cadeau-${Date.now()}.jpg`, { type: "image/jpeg" });
        onFiles([file]);
        closeCamera();
      },
      "image/jpeg",
      0.92,
    );
  }

  function openPicker() {
    setMenuOpen(false);
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
        accept="image/*,.pdf"
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        className={cn(
          "lm-gift-portal group relative block w-full overflow-hidden text-left",
          rail && "lm-gift-portal--rail",
          panel && "lm-gift-portal--panel",
          reveal && "lm-gift-portal--open",
        )}
        style={sceneTilt}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => {
          if (!menuOpen) setHover(false);
          resetTilt();
        }}
        onPointerMove={onPointerMove}
        onFocus={() => setHover(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !menuOpen) {
            setHover(false);
            resetTilt();
          }
        }}
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-controls={`${uid}-menu`}
        aria-label="Capturer un cadeau ou une dotation"
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
                {reveal
                  ? "Cliquez — photo ou import de la pièce"
                  : "Produit reçu, nature · art. 82 CGI"}
              </p>
            </div>

            <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-foreground/35 sm:inline">
              {menuOpen ? "fermer" : "ouvrir"}
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
            <div className="relative z-20 mt-6 max-w-xs text-center">
              <p className="lm-gift-copy font-display text-xl text-ink-foreground">
                {reveal ? "Capturez la pièce" : "Un cadeau à déclarer ?"}
              </p>
              <p className="mt-1.5 text-xs text-ink-foreground/55">
                {reveal ? "Photo ou import" : "Survolez le carton"}
              </p>
            </div>
          </div>
        )}
      </button>

      {menuOpen && (
        <div
          id={`${uid}-menu`}
          className={cn(
            "lm-gift-sheet animate-rise",
            embedded ? "rounded-none border-x-0 border-b-0 border-t border-border" : "mt-3",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="lm-gift-sheet__head">
            <div className="flex items-center gap-3">
              <div className="lm-gift-sheet__avatar">
                <img src="/gifts/sitting-cat.original.gif" alt="" draggable={false} />
              </div>
              <div>
                <p className="font-display text-base tracking-tight">Capturer ce cadeau</p>
                <p className="text-xs text-muted-foreground">Dotation · produit reçu · nature</p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Fermer"
              className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              onClick={() => {
                setMenuOpen(false);
                setHover(false);
              }}
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="grid gap-2 p-3 sm:grid-cols-2">
            <button type="button" className="lm-gift-action lm-gift-action--primary" onClick={() => void openCamera()}>
              <span className="lm-gift-action__icon">
                <Camera className="size-4" />
              </span>
              <span className="text-left">
                <span className="block text-sm font-medium">Prendre une photo</span>
                <span className="block text-[11px] opacity-70">Caméra</span>
              </span>
            </button>
            <button type="button" className="lm-gift-action" onClick={openPicker}>
              <span className="lm-gift-action__icon">
                <ImagePlus className="size-4" />
              </span>
              <span className="text-left">
                <span className="block text-sm font-medium">Importer</span>
                <span className="block text-[11px] text-muted-foreground">Image ou PDF</span>
              </span>
            </button>
          </div>
          {camError && <p className="px-4 pb-3 text-xs text-warning-ink">{camError}</p>}
        </div>
      )}

      {camOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-lift">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="font-display text-base tracking-tight">Photo du cadeau</p>
              <button
                type="button"
                aria-label="Fermer la caméra"
                className="rounded-full p-1 text-muted-foreground hover:bg-secondary"
                onClick={closeCamera}
              >
                <X className="size-4" />
              </button>
            </div>
            <video ref={videoRef} playsInline muted className="aspect-4/3 w-full bg-ink object-cover" />
            <div className="flex justify-end gap-2 p-4">
              <Button type="button" variant="outline" className="rounded-full" onClick={closeCamera}>
                Annuler
              </Button>
              <Button type="button" variant="accent" className="rounded-full" onClick={snapPhoto}>
                <Camera className="size-4" /> Capturer
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
