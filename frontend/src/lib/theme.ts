import { useCallback, useEffect, useState } from "react";

/**
 * Thème clair / sombre. Le choix vit dans localStorage et s'applique via la classe `.dark` sur
 * <html> (variante Tailwind déclarée dans styles.css). Un script inline dans le <head> (voir
 * __root.tsx) rejoue ce choix avant le premier rendu, pour éviter le flash blanc au chargement.
 */

export type Theme = "light" | "dark";

export const THEME_KEY = "lm.theme";
const EVT = "lm.theme.change";

/** Script inline injecté dans le <head> : doit rester autonome et sans dépendance. */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});if(!t){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}if(t==="dark"){document.documentElement.classList.add("dark");}}catch(e){}})();`;

export function getTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* stockage indisponible : le thème reste valable pour la session en cours */
  }
  window.dispatchEvent(new CustomEvent(EVT));
}

export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void } {
  // Rendu serveur et premier rendu client partent du thème clair : le script de bootstrap a déjà
  // posé la classe sur <html>, l'effet ci-dessous resynchronise l'état React juste après.
  const [theme, setState] = useState<Theme>("light");

  useEffect(() => {
    const sync = () => setState(getTheme());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback(() => {
    setTheme(getTheme() === "dark" ? "light" : "dark");
  }, []);

  return { theme, toggle, setTheme };
}
