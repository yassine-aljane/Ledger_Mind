// Identité anonyme stable par navigateur — évite que tous les visiteurs non connectés partagent
// la même mémoire de guidance côté backend (voir app/api/guidance.py, en-tête `X-Anon-Id`).
const KEY = "lm.anon_id";

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getAnonId(): string {
  if (typeof window === "undefined") return genId();
  try {
    let id = window.localStorage.getItem(KEY);
    if (!id) {
      id = genId();
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return genId();
  }
}
