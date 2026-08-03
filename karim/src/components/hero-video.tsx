import { useEffect, useRef, useState } from "react";
import creatorClip from "@/assets/creator-clip.mp4";
import creatorPoster from "@/assets/creator-hero.jpg";

const FALLBACK_SRC =
  "https://id-preview--9d2ccf3f-f0a1-4ee6-874c-e3427477334f.lovable.app/__l5e/assets-v1/dfe691cf-e0ce-43ed-8d6e-01f509e97a4e/creator-clip.mp4";

function silence(el: HTMLVideoElement) {
  el.muted = true;
  el.defaultMuted = true;
  el.volume = 0;
  el.setAttribute("muted", "");
}

/** Phone-mockup video — silent loop (no voice / no audio). */
export function HeroVideo({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState(creatorClip);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    silence(el);

    const playSilent = () => {
      silence(el);
      void el.play().catch(() => undefined);
    };
    const keepSilent = () => silence(el);

    playSilent();
    el.addEventListener("canplay", playSilent);
    el.addEventListener("play", keepSilent);
    el.addEventListener("volumechange", keepSilent);

    return () => {
      el.removeEventListener("canplay", playSilent);
      el.removeEventListener("play", keepSilent);
      el.removeEventListener("volumechange", keepSilent);
    };
  }, [src]);

  return (
    <video
      ref={ref}
      className={className}
      src={src}
      poster={creatorPoster}
      autoPlay
      loop
      muted
      defaultMuted
      playsInline
      preload="auto"
      controls={false}
      disablePictureInPicture
      onLoadedMetadata={(e) => silence(e.currentTarget)}
      onError={() => {
        if (src !== FALLBACK_SRC) setSrc(FALLBACK_SRC);
      }}
    />
  );
}
