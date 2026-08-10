import { formatMoney } from "@/lib/api";
import type { Calcul, Qualification } from "@/lib/mocks";

export function FiscalReceipt({
  qualification,
  calcul,
}: {
  qualification: Qualification;
  calcul: Calcul;
}) {
  return (
    <div className="relative group [perspective:1200px]">
      <div className="absolute inset-0 translate-y-8 scale-90 bg-black/15 blur-3xl opacity-40" aria-hidden />
      <div className="relative w-80 mx-auto bg-card shadow-[0_20px_60px_-15px_rgba(22,36,31,0.25)] ring-1 ring-black/5 transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_28px_70px_-14px_rgba(22,36,31,0.32)]">
        <div className="perforated-top h-4 w-full" aria-hidden />

        {/*
          Plancher typographique à 12 px, mentions légales comprises.
          Un vrai ticket de caisse imprime en 8 pt, mais ce document-ci se lit à l'écran et
          porte des montants que l'utilisateur doit pouvoir vérifier. Les petites lignes en
          9 px à opacité 0,4 mesuraient 2,53:1 — sous le seuil de lisibilité, pas seulement
          « discret ». Elles gardent leur retrait par l'opacité, remontée à 0,6 (4,62:1) et
          0,7 (6,50:1), et non plus par la taille.

          `text-card-foreground` et non `text-ink` : en thème sombre, `--ink` (L 0.16) tombait
          sur un fond de carte à L 0.225 — 1,14:1, un reçu littéralement invisible. Le jeton de
          premier plan de la carte s'inverse avec le thème et rend le même noir d'encre en clair
          (14,65:1 en sombre).
        */}
        <div className="px-8 pt-2 pb-8 font-mono text-xs text-card-foreground">
          <div className="text-center space-y-1 mb-6">
            <p className="font-bold text-sm tracking-tighter">LEDGERMIND FISCAL</p>
            <p className="opacity-70">REÇU DE QUALIFICATION</p>
            <p className="opacity-70">#{calcul.reference}</p>
            <p className="opacity-70">{calcul.date} — {calcul.client}</p>
          </div>

          <div className="dotted-divider my-4" />

          <p className="text-xs uppercase tracking-[0.12em] opacity-60 mb-3">Base</p>
          <div className="flex justify-between mb-3">
            <span>MONTANT HT</span>
            <span className="font-semibold">{formatMoney(calcul.montant_ht)}</span>
          </div>

          <div className="dotted-divider my-4" />

          <p className="text-xs uppercase tracking-[0.12em] opacity-60 mb-3">Postes fiscaux</p>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between gap-3">
                <span>TVA ({(qualification.taux_tva * 100).toFixed(0)}%)</span>
                <span className="text-amber-fiscal font-semibold">+ {formatMoney(calcul.tva)}</span>
              </div>
              <p className="text-xs opacity-60 italic mt-1">{qualification.base_legale}</p>
            </div>
            <div>
              <div className="flex justify-between gap-3">
                <span>RETENUE SOURCE ({(qualification.taux_rs * 100).toFixed(0)}%)</span>
                <span className="text-amber-fiscal font-semibold">− {formatMoney(calcul.retenue_source)}</span>
              </div>
              <p className="text-xs opacity-60 italic mt-1">Prélevée par le client</p>
            </div>
            <div className="flex justify-between gap-3">
              <span>CSS</span>
              <span className="text-amber-fiscal font-semibold">− {formatMoney(calcul.css)}</span>
            </div>
          </div>

          <div className="border-t-2 border-double border-current/40 my-5" />

          <div className="flex justify-between items-baseline gap-3 mb-6">
            <span className="font-sans font-bold text-sm">NET À PERCEVOIR</span>
            <span className="font-bold text-xl">{formatMoney(calcul.net_a_percevoir)} €</span>
          </div>

          {/* `primary` plutôt que `teal-dark` : en sombre, teal-dark s'éclaircit (L 0.72) et
              portait du texte presque blanc — 2,04:1. La paire primary/primary-foreground est
              justement celle qui s'inverse ensemble (14,63:1 dans les deux thèmes). */}
          <div className="rounded-lg bg-primary p-4 text-primary-foreground">
            <div className="flex justify-between items-end gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] opacity-90 font-bold">
                  Provision
                  <br />
                  conseillée
                </p>
                <p className="text-xs opacity-80 mt-1.5 font-sans max-w-[18ch] leading-snug">
                  À mettre de côté pour vos échéances.
                </p>
              </div>
              <span className="font-bold text-2xl">{formatMoney(calcul.provision_conseillee)} €</span>
            </div>
          </div>

          <div className="mt-6 text-xs opacity-70 leading-snug">
            <p>{qualification.explication_simple}</p>
          </div>

          <div className="text-center tracking-[0.25em] font-bold py-4 opacity-70 text-xs mt-2">
            MERCI DE VOTRE CONFIANCE
          </div>

          <div className="h-10 w-full flex gap-[2px] opacity-80 overflow-hidden" aria-hidden>
            {[1, 2, 0.5, 3, 1, 2, 0.5, 1.5, 2, 0.5, 3, 1, 0.5, 2, 1.5, 1, 3, 0.5, 2, 1, 0.5, 2, 1.5, 3, 1].map(
              (w, i) => (
                <div key={i} style={{ width: `${w * 2}px` }} className="h-full bg-current" />
              ),
            )}
          </div>
        </div>

        <div className="perforated-bottom h-4 w-full" aria-hidden />
      </div>
    </div>
  );
}
