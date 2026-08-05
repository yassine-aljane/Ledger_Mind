/**
 * Historique des conversations de l'espace guidance / pédagogue.
 */

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/guidance-api";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

export function ConversationHistory({
  conversations,
  currentId,
  onOpen,
  onNew,
  onRename,
  onDelete,
  showNewButton = true,
}: {
  conversations: ConversationSummary[];
  currentId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  showNewButton?: boolean;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startRename = (conv: ConversationSummary) => {
    setRenaming(conv.id);
    setDraft(conv.title);
  };

  const commitRename = (id: string) => {
    const title = draft.trim();
    if (title) onRename(id, title);
    setRenaming(null);
  };

  return (
    <aside className="h-fit rounded-2xl border border-border bg-card p-4 shadow-soft">
      {showNewButton && (
        <Button onClick={onNew} className="w-full rounded-full text-sm">
          <Plus className="size-3.5" /> Nouvelle conversation
        </Button>
      )}

      <p className={cn("rule-label text-muted-foreground", showNewButton ? "mt-5" : "mt-0")}>
        Historique
      </p>

      {conversations.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Aucune conversation pour l&apos;instant.
        </p>
      ) : (
        <ul className="chat-scroll mt-3 max-h-[52vh] space-y-1.5 overflow-y-auto">
          {conversations.map((conv) => {
            const active = conv.id === currentId;
            return (
              <li key={conv.id}>
                <div
                  className={cn(
                    "group cursor-pointer rounded-xl border px-3 py-2 transition-all duration-200",
                    active
                      ? "border-accent/50 bg-accent/10"
                      : "border-transparent hover:border-border hover:bg-secondary/60",
                  )}
                  onClick={() => renaming !== conv.id && onOpen(conv.id)}
                >
                  {renaming === conv.id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(conv.id);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={() => commitRename(conv.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Renommer la conversation"
                      className="input-boxed w-full rounded-lg border border-border bg-background px-2 py-1 text-sm focus:border-ink focus:outline-none"
                    />
                  ) : (
                    <>
                      <p className="truncate text-sm font-medium">{conv.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDate(conv.date)}
                        {conv.apercu ? ` · ${conv.apercu}` : ""}
                      </p>
                      <div className="mt-1.5 flex gap-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startRename(conv);
                          }}
                          className="rule-label inline-flex items-center gap-1 text-muted-foreground transition-colors duration-200 hover:text-foreground"
                        >
                          <Pencil className="size-3" /> Renommer
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(conv.id);
                          }}
                          className="rule-label inline-flex items-center gap-1 text-muted-foreground transition-colors duration-200 hover:text-destructive"
                        >
                          <Trash2 className="size-3" /> Supprimer
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
