import { Bot, Loader2, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  askCaptureQuestion,
  fetchCaptureDocumentMessages,
  type CaptureDocumentMessage,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/lm/Markdown";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type Props = {
  documentId: string;
  label: string;
  onClose: () => void;
};

type Turn = { role: "user" | "assistant"; content: string; pending?: boolean };

/**
 * Discussion attachée à un document précis (facture ou virement), avec son historique
 * persisté côté serveur.
 *
 * Le panneau est monté sur le Sheet shadcn (Radix Dialog) : le contenu est porté dans <body>,
 * donc il n'est jamais rogné par le `backdrop-blur` de la barre de navigation, qui crée un bloc
 * conteneur pour les descendants `fixed`.
 */
export function DocumentChatDrawer({ documentId, label, onClose }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCaptureDocumentMessages(documentId)
      .then((messages: CaptureDocumentMessage[]) => {
        if (cancelled) return;
        setTurns(
          messages.map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          })),
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, sending]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || sending) return;
    setQuestion("");
    setTurns((prev) => [...prev, { role: "user", content: q }]);
    setSending(true);
    try {
      const res = await askCaptureQuestion(documentId, q);
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: res.answer || res.error || "Je n'ai pas pu répondre." },
      ]);
    } catch (err) {
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: err instanceof Error ? err.message : "Erreur inattendue." },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="shrink-0 space-y-1 border-b border-border px-6 py-5 pr-14 text-left">
          <SheetDescription className="rule-label text-accent-ink">
            Question sur ce document
          </SheetDescription>
          <SheetTitle className="truncate font-display text-base font-medium">{label}</SheetTitle>
        </SheetHeader>

        <div ref={scrollRef} className="chat-scroll flex-1 space-y-4 overflow-y-auto px-6 py-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Chargement de la conversation…
            </div>
          ) : turns.length === 0 ? (
            <p className="pt-10 text-center text-sm text-muted-foreground">
              Posez une question sur ce document — montant, échéance, cohérence, IBAN…
            </p>
          ) : (
            turns.map((t, i) =>
              t.role === "assistant" ? (
                <div key={i} className="animate-rise flex gap-3">
                  <div className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <Bot className="size-3.5" />
                  </div>
                  {/* Le modèle répond en markdown : sans rendu, les `**` et les `#`
                      s'affichaient littéralement au milieu du texte. La réponse de
                      l'utilisateur, elle, reste du texte brut — c'est sa saisie. */}
                  <div className="min-w-0 rounded-2xl rounded-bl-none border border-border bg-secondary/50 p-3.5 text-sm leading-relaxed">
                    <Markdown text={t.content} />
                  </div>
                </div>
              ) : (
                <div key={i} className="animate-rise flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-none bg-primary p-3.5 text-sm font-medium text-primary-foreground">
                    {t.content}
                  </div>
                </div>
              ),
            )
          )}
          {sending && (
            <div className="flex gap-3">
              <div className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Bot className="size-3.5" />
              </div>
              <div className="flex gap-1.5 rounded-2xl rounded-bl-none border border-border bg-secondary/50 p-3.5">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                <span className="size-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
                <span className="size-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSend} className="flex shrink-0 gap-2 border-t border-border p-4">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ex. Ce virement est-il cohérent ?"
            aria-label="Votre question sur ce document"
            className="input-boxed flex-1 rounded-xl border border-border bg-card px-4 py-2.5 text-sm focus:border-ink focus:outline-none"
          />
          <Button type="submit" size="icon" disabled={sending || !question.trim()}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            <span className="sr-only">Envoyer</span>
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
