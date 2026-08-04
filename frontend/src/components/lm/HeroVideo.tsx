import { useEffect, useRef } from "react";
import heroClip from "@/assets/hero-workspace.mp4";
import heroPoster from "@/assets/hero-workspace-poster.jpg";

/**
 * Fond vidéo du héros — bureau créateur (laptop + smartphone), sans visage flou.
 * Clip Pexels libre d'usage ; poster de secours si l'autoplay est bloqué.
 */
export function HeroVideo({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = true;
    const play = () => {
      void el.play().catch(() => undefined);
    };
    play();
    el.addEventListener("canplay", play);
    return () => el.removeEventListener("canplay", play);
  }, []);

  return (
    <video
      ref={ref}
      className={className}
      src={heroClip}
      poster={heroPoster}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
    />
  );
}
