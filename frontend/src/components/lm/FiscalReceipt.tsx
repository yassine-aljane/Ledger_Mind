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
      <div className="relative w-80 mx-auto bg-white shadow-[0_20px_60px_-15px_rgba(22,36,31,0.25)] ring-1 ring-black/5 transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_28px_70px_-14px_rgba(22,36,31,0.32)]">
        <div className="perforated-top h-4 w-full" aria-hidden />

        <div className="px-8 pt-2 pb-8 font-mono text-[11px] text-ink">
          <div className="text-center space-y-1 mb-6">
            <p className="font-bold text-sm tracking-tighter">LEDGERMIND FISCAL</p>
            <p className="opacity-50">REÇU DE QUALIFICATION</p>
            <p className="opacity-50">#{calcul.reference}</p>
            <p className="opacity-50">{calcul.date} — {calcul.client}</p>
          </div>

          <div className="dotted-divider my-4" />

          <p className="text-[10px] uppercase tracking-widest opacity-40 mb-3">Base</p>
          <div className="flex justify-between mb-3">
            <span>MONTANT HT</span>
            <span className="font-medium">{formatMoney(calcul.montant_ht)}</span>
          </div>

          <div className="dotted-divider my-4" />

          <p className="text-[10px] uppercase tracking-widest opacity-40 mb-3">Postes fiscaux</p>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between">
                <span>TVA ({(qualification.taux_tva * 100).toFixed(0)}%)</span>
                <span className="text-amber-fiscal">+ {formatMoney(calcul.tva)}</span>
              </div>
              <p className="text-[9px] opacity-40 italic mt-0.5">{qualification.base_legale}</p>
            </div>
            <div>
              <div className="flex justify-between">
                <span>RETENUE SOURCE ({(qualification.taux_rs * 100).toFixed(0)}%)</span>
                <span className="text-amber-fiscal">− {formatMoney(calcul.retenue_source)}</span>
              </div>
              <p className="text-[9px] opacity-40 italic mt-0.5">Prélevée par le client</p>
            </div>
            <div className="flex justify-between">
              <span>CSS</span>
              <span className="text-amber-fiscal">− {formatMoney(calcul.css)}</span>
            </div>
          </div>

          <div className="border-t-2 border-double border-ink/40 my-5" />

          <div className="flex justify-between items-baseline mb-6">
            <span className="font-sans font-bold text-sm">NET À PERCEVOIR</span>
            <span className="font-bold text-lg">{formatMoney(calcul.net_a_percevoir)} €</span>
          </div>

          <div className="rounded-lg bg-teal-dark p-4 text-background">
            <div className="flex justify-between items-end">
              <div>
                <p className="text-[10px] uppercase tracking-widest opacity-80 font-bold">
                  Provision
                  <br />
                  conseillée
                </p>
                <p className="text-[9px] opacity-70 mt-1 font-sans max-w-[16ch] leading-tight">
                  À mettre de côté pour vos échéances.
                </p>
              </div>
              <span className="font-bold text-xl">{formatMoney(calcul.provision_conseillee)} €</span>
            </div>
          </div>

          <div className="mt-6 text-[9px] opacity-40 leading-tight">
            <p>{qualification.explication_simple}</p>
          </div>

          <div className="text-center tracking-[0.3em] font-bold py-4 opacity-60 text-[9px] mt-2">
            MERCI DE VOTRE CONFIANCE
          </div>

          <div className="h-10 w-full flex gap-[2px] opacity-80 overflow-hidden" aria-hidden>
            {[1, 2, 0.5, 3, 1, 2, 0.5, 1.5, 2, 0.5, 3, 1, 0.5, 2, 1.5, 1, 3, 0.5, 2, 1, 0.5, 2, 1.5, 3, 1].map(
              (w, i) => (
                <div key={i} style={{ width: `${w * 2}px` }} className="h-full bg-ink" />
              ),
            )}
          </div>
        </div>

        <div className="perforated-bottom h-4 w-full" aria-hidden />
      </div>
    </div>
  );
}
