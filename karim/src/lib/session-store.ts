const KEY = "ledgermind.session";

export type FlowBranch = "intake" | "guidance";

export function saveSession(branch: FlowBranch, sessionId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${KEY}.${branch}`, sessionId);
}

export function loadSession(branch: FlowBranch): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`${KEY}.${branch}`);
}

export function clearSession(branch: FlowBranch) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(`${KEY}.${branch}`);
}

export function clearAllSessions() {
  clearSession("intake");
  clearSession("guidance");
}
