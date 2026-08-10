import { Loader2, MessageCircleQuestion, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/lm/Markdown";
import { Button } from "@/components/ui/button";
import {
  askProductAssistant,
  type ProductAssistantSource,
} from "@/lib/product-assistant-api";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: ProductAssistantSource[];
  error?: boolean;
};

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Bonjour ! Je suis le Chat LedgerMind. Je peux vous expliquer les fonctionnalités, les tarifs et le parcours qui vous correspond.",
};

const SUGGESTIONS = [
  "Que fait LedgerMind ?",
  "Combien coûte Premium ?",
  "Puis-je commencer sans SIRET ?",
] as const;

const PIXEL_CAT = "/mascots/mistral-cat-walking.png";

function PixelCat({ className }: { className?: string }) {
  return (
    <img
      src={PIXEL_CAT}
      alt=""
      aria-hidden
      draggable={false}
      className={cn("select-none object-contain [image-rendering:pixelated]", className)}
    />
  );
}

/** Révèle les réponses progressivement, sans faire répéter chaque caractère au lecteur d'écran. */
function TypewriterMarkdown({ text }: { text: string }) {
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(text.length);
      return;
    }
    setVisible(0);
    const step = Math.max(1, Math.ceil(text.length / 140));
    const timer = window.setInterval(() => {
      setVisible((current) => {
        const next = Math.min(text.length, current + step);
        if (next === text.length) window.clearInterval(timer);
        return next;
      });
    }, 18);
    return () => window.clearInterval(timer);
  }, [text]);

  const complete = visible >= text.length;
  return (
    <div className="relative">
      <span className="sr-only">{text}</span>
      <div aria-hidden>
        <Markdown text={text.slice(0, visible)} />
        {!complete && <span className="lm-product-type-caret" />}
      </div>
    </div>
  );
}

export function ProductAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(rawQuestion?: string) {
    const question = (rawQuestion ?? input).trim();
    if (!question || busy) return;
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
    };
    const previous = messages.filter((message) => message.id !== "welcome");
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setBusy(true);
    try {
      const result = await askProductAssistant(
        question,
        previous.map(({ role, content }) => ({ role, content })),
      );
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.answer,
          sources: result.sources,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: error instanceof Error ? error.message : "Le chatbot est indisponible.",
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-[90] sm:bottom-6 sm:right-6">
      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby="product-chat-title"
          className="animate-rise fixed inset-3 flex flex-col overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-2xl sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(650px,calc(100vh-7rem))] sm:w-[400px]"
        >
          <header className="relative overflow-hidden bg-ink px-5 py-4 text-ink-foreground">
            <div aria-hidden className="absolute -right-8 -top-12 size-32 rounded-full bg-accent/25 blur-2xl" />
            <div className="relative flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-2xl bg-accent/90 shadow-soft">
                <PixelCat className="w-11" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="product-chat-title" className="font-display text-lg">Le Chat LedgerMind</h2>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-foreground/60">
                  <span className="size-1.5 rounded-full bg-success" /> Agent produit · Mistral + Pinecone
                </p>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => setOpen(false)}
                aria-label="Fermer le chatbot"
                className="text-ink-foreground hover:bg-ink-foreground/10 hover:text-ink-foreground"
              >
                <X />
              </Button>
            </div>
          </header>

          <div className="chat-scroll flex-1 space-y-4 overflow-y-auto bg-secondary/25 px-4 py-5" aria-live="polite">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
              >
                <div className="max-w-[88%]">
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-soft",
                      message.role === "user"
                        ? "rounded-br-md bg-primary text-primary-foreground"
                        : message.error
                          ? "rounded-bl-md border border-destructive/25 bg-destructive/8 text-destructive"
                          : "rounded-bl-md border border-border bg-card text-card-foreground",
                    )}
                  >
                    {message.role === "assistant" ? (
                      <TypewriterMarkdown text={message.content} />
                    ) : (
                      message.content
                    )}
                  </div>
                  {(message.sources?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 px-1">
                      {message.sources!.map((source) => (
                        <span
                          key={source.title}
                          title={source.section}
                          className="max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-[10px] text-muted-foreground"
                        >
                          Doc · {source.title}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {messages.length === 1 && (
              <div className="space-y-2 pt-1">
                <p className="rule-label px-1 text-muted-foreground">Questions fréquentes</p>
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="block w-full rounded-xl border border-border bg-card px-3 py-2.5 text-left text-xs font-medium transition hover:border-accent hover:bg-accent/8"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            {busy && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-soft">
                  <span className="w-14 overflow-hidden" aria-hidden>
                    <PixelCat className="lm-product-search-cat w-12" />
                  </span>
                  Je cherche dans la documentation…
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
            className="border-t border-border bg-card p-3"
          >
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-background p-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                maxLength={800}
                placeholder="Posez une question sur LedgerMind…"
                aria-label="Votre question sur LedgerMind"
                className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground/65"
              />
              <Button type="submit" size="icon" disabled={!input.trim() || busy} aria-label="Envoyer">
                {busy ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </div>
            <p className="mt-2 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
              <Sparkles className="size-3" /> Réponses basées sur la documentation LedgerMind
            </p>
          </form>
        </section>
      )}

      {open ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Fermer le chatbot LedgerMind"
          className="hidden size-14 place-items-center rounded-full border-4 border-background bg-ink text-ink-foreground shadow-2xl transition hover:-translate-y-1 hover:bg-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/35 sm:grid"
        >
          <MessageCircleQuestion className="size-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded="false"
          aria-label="Ouvrir le chatbot LedgerMind"
          className="lm-product-launcher group relative overflow-hidden border-4 border-background bg-card text-ink shadow-2xl hover:-translate-y-1 hover:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/35"
        >
          <span className="lm-product-launcher__icon" aria-hidden>
            <PixelCat className="w-12" />
          </span>
          <span className="lm-product-launcher__copy" aria-hidden>
            <strong>Une question&nbsp;?</strong>
            <small>Découvrez LedgerMind</small>
          </span>
          <span className="lm-product-launcher__cat-track" aria-hidden>
            <PixelCat className="lm-product-launcher__cat w-[82px]" />
          </span>
        </button>
      )}
    </div>
  );
}
