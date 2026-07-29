/**
 * Historique des conversations de l'espace guidance.
 *
 * Chaque échange est repris là où il s'était arrêté (messages, profil, feuille de route et
 * cases cochées sont rechargés depuis le serveur), renommable et supprimable.
 */

import { useState } from "react";
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
}: {
  conversations: ConversationSummary[];
  currentId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
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
    <aside className="bg-white border border-border rounded-2xl p-4 h-fit lg:sticky lg:top-6">
      <button
        onClick={onNew}
        className="w-full px-4 py-2.5 bg-ink text-background rounded-xl text-sm font-semibold hover:bg-teal-dark transition-colors"
      >
        + Nouvelle conversation
      </button>

      <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.25em] text-ink/40">
        Historique
      </p>

      {conversations.length === 0 ? (
        <p className="mt-3 text-xs text-ink/40 leading-relaxed">
          Aucune conversation pour l&apos;instant.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5 max-h-[52vh] overflow-y-auto">
          {conversations.map((conv) => {
            const active = conv.id === currentId;
            return (
              <li key={conv.id}>
                <div
                  className={`group rounded-xl border px-3 py-2 transition-colors cursor-pointer ${
                    active
                      ? "border-teal-dark bg-teal-light/20"
                      : "border-transparent hover:border-border hover:bg-background"
                  }`}
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
                      className="w-full px-2 py-1 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-teal-dark"
                    />
                  ) : (
                    <>
                      <p className="text-sm font-medium text-ink truncate">{conv.title}</p>
                      <p className="text-[11px] text-ink/40 truncate">
                        {formatDate(conv.date)}
                        {conv.apercu ? ` · ${conv.apercu}` : ""}
                      </p>
                      <div className="flex gap-3 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startRename(conv);
                          }}
                          className="text-[10px] font-mono uppercase tracking-wider text-ink/40 hover:text-teal-dark"
                        >
                          Renommer
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(conv.id);
                          }}
                          className="text-[10px] font-mono uppercase tracking-wider text-ink/40 hover:text-coral"
                        >
                          Supprimer
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
