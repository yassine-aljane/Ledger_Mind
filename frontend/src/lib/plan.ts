import { useEffect, useState } from "react";

export type Plan = "free" | "premium";
const KEY = "lm.plan";
const EVT = "lm.plan.change";

export function getPlan(): Plan {
  if (typeof window === "undefined") return "free";
  try {
    return (window.localStorage.getItem(KEY) as Plan) ?? "free";
  } catch {
    return "free";
  }
}

export function setPlan(p: Plan) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, p);
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    // ignore
  }
}

export function isPremium() {
  return getPlan() === "premium";
}

export function usePlan(): Plan {
  const [plan, setState] = useState<Plan>(() => getPlan());
  useEffect(() => {
    const sync = () => setState(getPlan());
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return plan;
}
