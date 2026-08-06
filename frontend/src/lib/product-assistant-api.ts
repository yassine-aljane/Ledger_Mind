const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";

export type ProductAssistantSource = {
  title: string;
  section: string;
  score: number;
};

export type ProductAssistantResponse = {
  answer: string;
  sources: ProductAssistantSource[];
};

export async function askProductAssistant(
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<ProductAssistantResponse> {
  const response = await fetch(`${API_BASE}/api/product-assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history: history.slice(-10) }),
  });
  if (!response.ok) {
    let message = "Le Chat LedgerMind est momentanément indisponible.";
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) message = payload.detail;
    } catch {
      // La réponse n'est pas JSON : garder le message stable du widget.
    }
    throw new Error(message);
  }
  return response.json() as Promise<ProductAssistantResponse>;
}

