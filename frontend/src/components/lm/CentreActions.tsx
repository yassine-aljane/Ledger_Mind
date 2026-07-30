import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { usePlan } from "@/lib/plan";
import {
  fetchAgenda,
  fetchHistorique,
  fetchVeille,
  marquerPaye,
  mettreAJourParametres,
  type AgendaResponse,
  type Echeance,
  type HistoriqueItem,
  type VeilleNouveaute,
} from "@/lib/echeancier-api";

type Vue = "agenda" | "veille" | "historique";

const COULEUR_STATUT: Record<Echeance["statut"], string> = {
  en_retard: "bg-coral",
  urgent: "bg-amber-fiscal",
  regularisee: "bg-teal-dark",
  a_venir: "bg-ink/20",
};

const LABEL_STATUT: Record<Echeance["statut"], string> = {
  en_retard: "En retard",
  urgent: "Approche",
  regularisee: "Réglée",
  a_venir: "À venir",
};

function libelleBouton(e: Echeance): string {
  if (e.statut === "regularisee") return "Voir le justificatif";
  if (e.fenetre_indicative && !e.date_limite) return "Préparer";
  return "Déclarer et payer";
}

function EcheanceCard({ e, onMarquerPaye }: { e: Echeance; onMarquerPaye: (e: Echeance) => void }) {
  return (
    <div className="bg-white border border-border rounded-2xl p-5 space-y-3 card-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`mt-1 size-2.5 rounded-full shrink-0 ${COULEUR_STATUT[e.statut]}`} />
          <div>
            <p className="font-semibold text-sm">{e.libelle}</p>
            <p className="text-xs text-ink/50">
              {e.date_limite
                ? `Avant le ${new Date(e.date_limite).toLocaleDateString("fr-FR")}`
                : e.fenetre_indicative}
              {" · "}
              {e.periode}
            </p>
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-widest font-semibold text-ink/50 shrink-0">
          {LABEL_STATUT[e.statut]}
        </span>
      </div>
      {e.statut !== "regularisee" && (
        <div className="flex flex-wrap gap-2">
          <a
            href={e.portail_paiement}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 bg-ink text-background rounded-lg text-xs font-medium hover:bg-teal-dark transition-all duration-200 active:scale-[0.97]"
          >
            {libelleBouton(e)} — {e.portail_label}
          </a>
          <button
            type="button"
            onClick={() => onMarquerPaye(e)}
            className="px-4 py-2 border border-border rounded-lg text-xs font-medium hover:border-ink transition-all duration-200 active:scale-[0.97]"
          >
            Marquer comme payé
          </button>
        </div>
      )}
      <p className="text-[10px] text-ink/30">Source : {e.source}</p>
    </div>
  );
}

function FormulaireParametres({
  manquants,
  onEnregistre,
}: {
  manquants: string[];
  onEnregistre: () => void;
}) {
  const [periodicite, setPeriodicite] = useState<"mensuelle" | "trimestrielle">("mensuelle");
  const [regimeTva, setRegimeTva] = useState<"franchise" | "reel_simplifie" | "reel_normal">("franchise");
  const [clientsUe, setClientsUe] = useState(false);
  const [loading, setLoading] = useState(false);

  async function enregistrer() {
    setLoading(true);
    try {
      const valeurs: Record<string, unknown> = {};
      if (manquants.includes("periodicite_urssaf")) valeurs.periodicite_urssaf = periodicite;
      if (manquants.includes("regime_tva")) valeurs.regime_tva = regimeTva;
      if (manquants.includes("revenus_intracommunautaires")) valeurs.revenus_intracommunautaires = clientsUe;
      await mettreAJourParametres(valeurs);
      onEnregistre();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-amber-fiscal/10 border border-amber-fiscal/30 rounded-2xl p-5 space-y-4">
      <p className="text-base font-semibold">
        Quelques informations pour affiner votre agenda (demandées une seule fois) :
      </p>
      {manquants.includes("periodicite_urssaf") && (
        <div>
          <label className="text-xs uppercase tracking-widest text-ink/50 font-semibold">
            Périodicité URSSAF
          </label>
          <select
            value={periodicite}
            onChange={(e) => setPeriodicite(e.target.value as typeof periodicite)}
            className="w-full mt-1 px-3 py-2 bg-white border border-border rounded-lg text-sm input-boxed"
          >
            <option value="mensuelle">Mensuelle</option>
            <option value="trimestrielle">Trimestrielle</option>
          </select>
        </div>
      )}
      {manquants.includes("regime_tva") && (
        <div>
          <label className="text-xs uppercase tracking-widest text-ink/50 font-semibold">
            Régime de TVA
          </label>
          <select
            value={regimeTva}
            onChange={(e) => setRegimeTva(e.target.value as typeof regimeTva)}
            className="w-full mt-1 px-3 py-2 bg-white border border-border rounded-lg text-sm input-boxed"
          >
            <option value="franchise">Franchise en base (pas de TVA)</option>
            <option value="reel_simplifie">Réel simplifié</option>
            <option value="reel_normal">Réel normal</option>
          </select>
        </div>
      )}
      {manquants.includes("revenus_intracommunautaires") && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={clientsUe} onChange={(e) => setClientsUe(e.target.checked)} />
          Je facture des clients professionnels établis dans un autre pays de l'UE
        </label>
      )}
      <button
        type="button"
        onClick={enregistrer}
        disabled={loading}
        className="px-5 py-2.5 bg-ink text-background rounded-lg text-sm font-medium hover:bg-teal-dark transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
      >
        {loading ? "Enregistrement…" : "Enregistrer"}
      </button>
    </div>
  );
}

function VueAgenda({ onOuvrirHistorique }: { onOuvrirHistorique: () => void }) {
  const [data, setData] = useState<AgendaResponse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function recharger() {
    setLoading(true);
    setErreur(null);
    fetchAgenda()
      .then(setData)
      .catch((e) => setErreur(e instanceof Error ? e.message : "Erreur de chargement."))
      .finally(() => setLoading(false));
  }

  useEffect(recharger, []);

  async function handleMarquerPaye(e: Echeance) {
    await marquerPaye(e.obligation_id, e.periode);
    recharger();
  }

  if (loading) return <p className="text-sm text-ink/40 text-center py-10">Chargement de l'agenda…</p>;

  if (erreur) {
    return (
      <div className="bg-white border border-border rounded-2xl p-8 text-center space-y-4">
        <p className="text-sm text-ink/60">{erreur}</p>
        <Link
          to="/onboarding/verification"
          className="inline-flex px-5 py-2.5 bg-ink text-background rounded-lg text-sm font-medium hover:bg-teal-dark transition-all duration-200 active:scale-[0.97]"
        >
          Vérifier mon SIREN
        </Link>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {data.parametres_manquants.length > 0 && (
        <FormulaireParametres manquants={data.parametres_manquants} onEnregistre={recharger} />
      )}
      {data.echeances.length === 0 ? (
        <p className="text-sm text-ink/40 text-center py-10">Aucune échéance applicable à votre profil.</p>
      ) : (
        data.echeances.map((e) => (
          <EcheanceCard key={e.id} e={e} onMarquerPaye={handleMarquerPaye} />
        ))
      )}
      <button
        type="button"
        onClick={onOuvrirHistorique}
        className="w-full text-center text-sm text-teal-dark font-medium hover:underline pt-2"
      >
        Voir l'historique fiscal complet →
      </button>
    </div>
  );
}

function VueHistorique({ onRetour }: { onRetour: () => void }) {
  const [items, setItems] = useState<HistoriqueItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistorique()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onRetour} className="text-sm text-teal-dark font-medium hover:underline">
        ← Retour à l'agenda
      </button>
      {loading ? (
        <p className="text-sm text-ink/40 text-center py-10">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink/40 text-center py-10">Aucun élément dans l'historique.</p>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <div key={`${it.type}-${it.id}`} className="bg-white border border-border rounded-2xl p-4 card-hover">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{it.libelle}</p>
                <span className="text-[10px] uppercase tracking-widest text-ink/40">{it.statut}</span>
              </div>
              <p className="text-xs text-ink/50">
                {new Date(it.date).toLocaleDateString("fr-FR")}
                {it.montant != null ? ` · ${it.montant.toFixed(2)} €` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VeilleCard({ n }: { n: VeilleNouveaute }) {
  return (
    <div className="bg-white border border-border rounded-2xl p-5 space-y-2 card-hover">
      <p className="font-semibold text-sm">{n.titre}</p>
      {n.resume && <p className="text-sm text-ink/70 leading-relaxed">{n.resume}</p>}
      {n.impact && (
        <p className="text-xs text-teal-dark bg-teal-dark/5 rounded-lg px-3 py-2">{n.impact}</p>
      )}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold">
          {n.source}
        </span>
        <a
          href={n.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-teal-dark font-medium hover:underline"
        >
          Voir la source →
        </a>
      </div>
    </div>
  );
}

function VueVeille() {
  const [data, setData] = useState<{ date: string | null; nouveautes: VeilleNouveaute[] } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVeille()
      .then(setData)
      .catch((e) => setErreur(e instanceof Error ? e.message : "Erreur de chargement."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-ink/40 text-center py-10">Chargement de la veille…</p>;

  if (erreur) {
    return (
      <div className="bg-white border border-border rounded-2xl p-8 text-center text-sm text-ink/50">
        {erreur}
      </div>
    );
  }

  if (!data || data.nouveautes.length === 0) {
    return (
      <div className="bg-white border border-border rounded-2xl p-8 text-center text-sm text-ink/50">
        Aucune nouveauté réglementaire pour votre activité pour l'instant — vous ne verrez ici que
        les actualités qui ont une réelle valeur pour votre situation.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.date && (
        <p className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold">
          Dernière vérification : {new Date(data.date).toLocaleDateString("fr-FR")}
        </p>
      )}
      {data.nouveautes.map((n, i) => (
        <VeilleCard key={`${n.url}-${i}`} n={n} />
      ))}
    </div>
  );
}

export function CentreActionsButton() {
  const [ouvert, setOuvert] = useState(false);
  const plan = usePlan();

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        title="Centre d'Actions"
        className="size-9 rounded-full border border-border flex items-center justify-center hover:border-ink transition-all duration-200 active:scale-[0.95] shrink-0"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {ouvert &&
        createPortal(
          // Rendu en portail dans <body> : le <nav> parent a un fond flouté (`backdrop-blur`),
          // qui en CSS établit un « containing block » pour tout descendant en `position: fixed`.
          // Sans le portail, ce panneau se retrouvait donc contraint à la boîte du <nav> (64px de
          // haut) au lieu de couvrir tout l'écran — il semblait « coincé dans la barre de nav ».
          <div className="fixed inset-0 z-50 flex justify-end">
            <div
              className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
              onClick={() => setOuvert(false)}
            />
            <div className="relative w-full max-w-md h-full bg-background border-l border-border shadow-2xl overflow-y-auto animate-slide-in-right">
              <PanneauCentreActions plan={plan} onFermer={() => setOuvert(false)} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function PanneauCentreActions({ plan, onFermer }: { plan: string; onFermer: () => void }) {
  const [vue, setVue] = useState<Vue>("agenda");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-xl">Centre d'Actions</h2>
        <button type="button" onClick={onFermer} className="text-ink/40 hover:text-ink text-xl leading-none">
          ×
        </button>
      </div>

      {plan === "free" ? (
        <div className="bg-white border border-border rounded-2xl p-8 text-center space-y-4">
          <p className="text-sm text-ink/60">
            L'agenda fiscal et la veille personnalisée font partie des fonctionnalités Premium.
          </p>
          <Link
            to="/premium"
            className="inline-flex px-5 py-2.5 bg-ink text-background rounded-lg text-sm font-medium hover:bg-teal-dark transition-all duration-200 active:scale-[0.97]"
          >
            Découvrir Premium
          </Link>
        </div>
      ) : (
        <>
          {vue !== "historique" && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setVue("agenda")}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  vue === "agenda" ? "bg-ink text-background" : "bg-white border border-border text-ink/70 hover:border-ink"
                }`}
              >
                Agenda fiscal
              </button>
              <button
                type="button"
                onClick={() => setVue("veille")}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  vue === "veille" ? "bg-ink text-background" : "bg-white border border-border text-ink/70 hover:border-ink"
                }`}
              >
                Veille réglementaire
              </button>
            </div>
          )}
          {vue === "agenda" && <VueAgenda onOuvrirHistorique={() => setVue("historique")} />}
          {vue === "veille" && <VueVeille />}
          {vue === "historique" && <VueHistorique onRetour={() => setVue("agenda")} />}
        </>
      )}
    </div>
  );
}
