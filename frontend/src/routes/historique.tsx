import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Inbox, TriangleAlert } from "lucide-react";
import { AccessGate } from "@/components/lm/AccessGate";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import {
  EtiquetteFiltresActifs,
  TransactionsFiltres,
} from "@/components/lm/TransactionsFiltres";
import {
  BandeauAnomalies,
  BandeauJustificatifs,
  TotauxPeriode,
} from "@/components/lm/TransactionsResume";
import { TransactionsTable } from "@/components/lm/TransactionsTable";
import {
  fetchCaptureCadeaux,
  fetchCaptureContrats,
  fetchCaptureInvoices,
  fetchCaptureVirements,
} from "@/lib/api";
import { isAuthed } from "@/lib/auth";
import { listerFactures } from "@/lib/facturation-api";
import {
  agregerAnomalies,
  appliquerFiltres,
  calculerTotaux,
  compterAvecAnomalie,
  compterSansJustificatif,
  construireFluxUnifie,
  FILTRES_PAR_DEFAUT,
  filtrerParPeriode,
  type FiltresTransactions,
  type SourcesFlux,
} from "@/lib/transactions";

export const Route = createFileRoute("/historique")({
  head: () => ({
    meta: [
      { title: "Transactions — LedgerMind" },
      { name: "description", content: "Toutes vos transactions qualifiées et leurs reçus fiscaux." },
      { property: "og:title", content: "Historique — LedgerMind" },
      {
        property: "og:description",
        content: "Toutes vos transactions qualifiées et leurs reçus fiscaux.",
      },
    ],
  }),
  component: HistoriqueRoute,
});

function HistoriqueRoute() {
  return (
    <AccessGate feature="historique" premiumKind="historique">
      <HistoriquePage />
    </AccessGate>
  );
}

/** Libellés affichés quand une source refuse de répondre. */
const LIBELLE_SOURCE_EN_ERREUR: Record<keyof SourcesFlux, string> = {
  facturesEmises: "factures émises",
  facturesRecues: "factures reçues",
  virements: "virements",
  cadeaux: "cadeaux",
  contrats: "contrats",
};

function HistoriquePage() {
  const [sources, setSources] = useState<SourcesFlux>({});
  const [enErreur, setEnErreur] = useState<(keyof SourcesFlux)[]>([]);
  const [chargement, setChargement] = useState(true);
  const [filtres, setFiltres] = useState<FiltresTransactions>(FILTRES_PAR_DEFAUT);

  // Les cinq listes sont indépendantes : elles partent en parallèle et l'échec de l'une
  // n'emporte pas les autres — un écran partiel vaut mieux qu'un écran vide.
  useEffect(() => {
    if (!isAuthed()) {
      setChargement(false);
      return;
    }
    let annule = false;

    (async () => {
      const [emises, recues, virements, cadeaux, contrats] = await Promise.allSettled([
        listerFactures(),
        fetchCaptureInvoices(),
        fetchCaptureVirements(),
        fetchCaptureCadeaux(),
        fetchCaptureContrats(),
      ]);
      if (annule) return;

      const echecs: (keyof SourcesFlux)[] = [];
      const collectees: SourcesFlux = {};

      if (emises.status === "fulfilled") collectees.facturesEmises = emises.value.factures ?? [];
      else echecs.push("facturesEmises");

      if (recues.status === "fulfilled") collectees.facturesRecues = recues.value ?? [];
      else echecs.push("facturesRecues");

      if (virements.status === "fulfilled") collectees.virements = virements.value ?? [];
      else echecs.push("virements");

      if (cadeaux.status === "fulfilled") collectees.cadeaux = cadeaux.value ?? [];
      else echecs.push("cadeaux");

      if (contrats.status === "fulfilled") collectees.contrats = contrats.value ?? [];
      else echecs.push("contrats");

      setSources(collectees);
      setEnErreur(echecs);
      setChargement(false);
    })();

    return () => {
      annule = true;
    };
  }, []);

  const flux = useMemo(() => construireFluxUnifie(sources), [sources]);

  // Le bandeau et les compteurs se calculent sur la période SEULE : cocher « avec
  // anomalie » ne doit pas faire fondre le nombre affiché sur le bouton qui l'a activé.
  const surPeriode = useMemo(
    () => filtrerParPeriode(flux, filtres.periode),
    [flux, filtres.periode],
  );
  const anomalies = useMemo(() => agregerAnomalies(surPeriode), [surPeriode]);
  const nbSansJustificatif = useMemo(() => compterSansJustificatif(surPeriode), [surPeriode]);
  const nbAvecAnomalie = useMemo(() => compterAvecAnomalie(surPeriode), [surPeriode]);

  const visibles = useMemo(() => appliquerFiltres(flux, filtres), [flux, filtres]);
  const totaux = useMemo(() => calculerTotaux(visibles), [visibles]);

  const aucuneDonnee = !chargement && flux.length === 0;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Transactions"
        title={
          <>
            Vos transactions, <span className="italic font-normal">expliquées.</span>
          </>
        }
        description="Factures émises et reçues, virements, cadeaux et contrats réunis en un seul flux. Ouvrez une ligne pour voir ce que l'analyse en a retenu."
      />

      {enErreur.length > 0 && (
        <div className="animate-rise mb-6 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">
            Impossible de charger&nbsp;:{" "}
            {enErreur.map((cle) => LIBELLE_SOURCE_EN_ERREUR[cle]).join(", ")}. Le reste de la
            liste est à jour.
          </p>
        </div>
      )}

      {aucuneDonnee ? (
        <EtatVide />
      ) : (
        <div className="space-y-6">
          <TotauxPeriode totaux={totaux} />

          {!chargement && (
            <div className="space-y-3">
              <BandeauAnomalies
                anomalies={anomalies}
                actif={filtres.avecAnomalie}
                onBasculer={() => setFiltres((f) => ({ ...f, avecAnomalie: !f.avecAnomalie }))}
              />
              <BandeauJustificatifs
                nombre={nbSansJustificatif}
                actif={filtres.sansJustificatif}
                onBasculer={() =>
                  setFiltres((f) => ({ ...f, sansJustificatif: !f.sansJustificatif }))
                }
              />
            </div>
          )}

          <TransactionsFiltres
            filtres={filtres}
            onChange={setFiltres}
            nbSansJustificatif={nbSansJustificatif}
            nbAvecAnomalie={nbAvecAnomalie}
          />

          <EtiquetteFiltresActifs
            filtres={filtres}
            nbResultats={visibles.length}
            onReinitialiser={() => setFiltres(FILTRES_PAR_DEFAUT)}
          />

          {!chargement && visibles.length === 0 ? (
            <AucunResultat onReinitialiser={() => setFiltres(FILTRES_PAR_DEFAUT)} />
          ) : (
            <TransactionsTable transactions={visibles} chargement={chargement} />
          )}
        </div>
      )}
    </AppShell>
  );
}

function EtatVide() {
  return (
    <div className="animate-rise rounded-2xl border border-border bg-card p-10 text-center shadow-soft">
      <Inbox className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-4 text-xl">Aucune transaction pour l'instant</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        Dès qu'une facture, un virement ou un cadeau est capturé, il apparaît ici avec
        l'explication de son traitement fiscal.
      </p>
      <div className="mt-6">
        <Link
          to="/capture"
          className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground shadow-soft transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]"
        >
          Capturer un justificatif
        </Link>
      </div>
    </div>
  );
}

function AucunResultat({ onReinitialiser }: { onReinitialiser: () => void }) {
  return (
    <div className="animate-rise rounded-2xl border border-border bg-card p-10 text-center shadow-soft">
      <p className="text-sm text-muted-foreground">
        Aucune transaction ne correspond à ces filtres.
      </p>
      <button
        type="button"
        onClick={onReinitialiser}
        className="mt-4 inline-flex h-9 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium transition-colors hover:border-ink"
      >
        Réinitialiser les filtres
      </button>
    </div>
  );
}
