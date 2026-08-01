import { useEffect, useRef } from "react";
import creatorClip from "@/assets/creator-clip.mp4";
import creatorPoster from "@/assets/creator-hero.jpg";

/** Vidéo du mockup téléphone — relancée après le montage (politiques d'autoplay). */
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
      src={creatorClip}
      poster={creatorPoster}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
    />
  );
}
