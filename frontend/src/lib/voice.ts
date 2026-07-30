// Assistant vocal — API navigateur NATIVE uniquement (Web Speech API) : aucune dépendance,
// aucun service externe, aucun coût. Dégradation propre si le navigateur ne supporte pas l'API :
// tout appelant doit vérifier `speechSupported()`/`recognitionSupported()` avant d'afficher les
// contrôles vocaux, jamais les rendre obligatoires.

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function recognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

let currentUtterance: SpeechSynthesisUtterance | null = null;

/**
 * Lit un texte à voix haute (français). Annule toute lecture en cours avant de démarrer.
 *
 * `onBoundary` (optionnel) reçoit la position (en caractères) atteinte par la synthèse à chaque
 * mot/phrase — permet d'afficher le texte progressivement, EN SYNC avec la voix, plutôt que d'un
 * bloc. Support variable selon navigateur (fiable sur Chrome ; sur les moteurs qui ne l'émettent
 * pas, `onEnd` révèle simplement le texte en entier — dégradation propre, jamais bloquant).
 */
export function speak(
  text: string,
  onEnd?: () => void,
  onBoundary?: (charIndex: number) => void,
): void {
  if (!speechSupported() || !text.trim()) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  utterance.rate = 1;
  utterance.onboundary = (event) => {
    if (typeof event.charIndex === "number") onBoundary?.(event.charIndex);
  };
  utterance.onend = () => {
    currentUtterance = null;
    onEnd?.();
  };
  utterance.onerror = () => {
    currentUtterance = null;
    onEnd?.();
  };
  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
  currentUtterance = null;
}

export function isSpeaking(): boolean {
  return speechSupported() && window.speechSynthesis.speaking;
}

export type RecognitionHandle = {
  stop: () => void;
};

/**
 * Démarre une écoute ponctuelle (une réponse). `onFinal` reçoit le texte transcrit final ;
 * `onInterim` (optionnel) reçoit les résultats provisoires pour un retour visuel pendant l'écoute.
 * Renvoie un handle pour arrêter l'écoute manuellement à tout moment.
 */
export function listenOnce(opts: {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}): RecognitionHandle | null {
  if (!recognitionSupported()) {
    opts.onError?.("La reconnaissance vocale n'est pas disponible sur ce navigateur.");
    return null;
  }
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const recognition = new Ctor();
  recognition.lang = "fr-FR";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalSent = false;

  recognition.onresult = (event: any) => {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += transcript;
      else interim += transcript;
    }
    if (final.trim()) {
      finalSent = true;
      opts.onFinal(final.trim());
    } else if (interim.trim()) {
      opts.onInterim?.(interim.trim());
    }
  };
  recognition.onerror = (event: any) => {
    if (event.error === "no-speech") return; // silence — pas une vraie erreur
    opts.onError?.(`Micro indisponible (${event.error}).`);
  };
  recognition.onend = () => {
    opts.onEnd?.();
  };

  try {
    recognition.start();
  } catch {
    opts.onError?.("Impossible de démarrer le micro.");
    return null;
  }

  return {
    stop: () => {
      if (!finalSent) {
        try {
          recognition.stop();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
