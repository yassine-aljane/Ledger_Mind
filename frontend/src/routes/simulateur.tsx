import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleAlert, Loader2, Table2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { AccessGate } from "@/components/lm/AccessGate";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { PanneauFigures } from "@/components/lm/PanneauFigures";
import { DetailCalcul, RepereAbattement } from "@/components/lm/ScenariosAnalyse";
import { ScenarioSaisie } from "@/components/lm/ScenarioSaisie";
import {
  CarteVerdict,
  ListeRecommandations,
} from "@/components/lm/ScenarioRecommandations";
import { construireRecommandations, construireVerdict } from "@/lib/recommandations";
import { couleurSerie } from "@/lib/scenarios-series";
import { isAuthed } from "@/lib/auth";
import { construireSynthese, formatEuros, formatPct } from "@/lib/finance";
import { listerFactures, type Facture } from "@/lib/facturation-api";
import {
  avertissementsUniques,
  chargerContexte,
  construireCascade,
  construireComparaisonOption,
  construireDecomposition,
  construireEcarts,
  construireFluxEuro,
  construireProjection,
  construireProvisions,
  depassementsParScenario,
  etapesCalcul,
  lireProvenance,
  simulerScenarios,
  versVariante,
  type CategorieFiscale,
  type ContexteSimulation,
  type ReponseScenarios,
  type ScenarioInterprete,
} from "@/lib/scenarios";

export const Route = createFileRoute("/simulateur")({
  head: () => ({
    meta: [
      { title: "Scénarios — LedgerMind" },
      { name: "description", content: "Simulez l'impact fiscal d'un contrat en langage naturel." },
      { property: "og:title", content: "Scénarios — LedgerMind" },
      { property: "og:description", content: "Simulez l'impact fiscal d'un contrat en langage naturel." },
    ],
  }),
  component: SimulateurRoute,
});

function SimulateurRoute() {
  return (
    <AccessGate feature="simulateur" premiumKind="simulateur">
      <SimulateurPage />
    </AccessGate>
  );
}

const PHRASE_INITIALE = "Si je signe ce contrat de 5 000 € avec un client français, combien je garde ?";

/**
 * L'écran suit un récit en trois temps : ce que j'ai compris, ce que ça change, pourquoi.
 *
 * L'ordre n'est pas cosmétique. Un chiffre fiscal n'a de valeur que si son hypothèse est
 * vérifiable : montrer le résultat avant la compréhension inviterait à faire confiance à
 * une lecture qu'on n'a pas relue.
 */
function SimulateurPage() {
  const [contexte, setContexte] = useState<ContexteSimulation | null>(null);
  const [factures, setFactures] = useState<Facture[]>([]);
  const [phrase, setPhrase] = useState(PHRASE_INITIALE);
  const [compris, setCompris] = useState<ScenarioInterprete[]>([]);
  const [resume, setResume] = useState<string | null>(null);
  const [retenus, setRetenus] = useState<string[]>([]);
  const [reponse, setReponse] = useState<ReponseScenarios | null>(null);
  const [chargement, setChargement] = useState(true);
  const [calcul, setCalcul] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Le contexte (CA réel, foyer déclaré) et l'historique de facturation sont indépendants :
  // l'échec de l'un ne doit pas priver l'écran de l'autre.
  useEffect(() => {
    if (!isAuthed()) {
      setChargement(false);
      return;
    }
    let annule = false;

    (async () => {
      const [ctx, fac] = await Promise.allSettled([chargerContexte(), listerFactures()]);
      if (annule) return;

      if (ctx.status === "fulfilled") setContexte(ctx.value);
      else setErreur(ctx.reason instanceof Error ? ctx.reason.message : "Contexte indisponible.");

      if (fac.status === "fulfilled") setFactures(fac.value.factures ?? []);
      setChargement(false);
    })();

    return () => {
      annule = true;
    };
  }, []);

  const categorieParDefaut: CategorieFiscale =
    contexte?.base?.activites?.[0]?.categorie ?? "BNC";

  // Les variantes envoyées au moteur découlent de ce que l'utilisateur a RETENU, dans
  // l'ordre où il l'a retenu : c'est ce même ordre qui fixe les teintes des courbes.
  const variantes = useMemo(
    () =>
      retenus
        .map((id) => compris.find((s) => s.id === id))
        .filter((s): s is ScenarioInterprete => s != null)
        .map((s) => versVariante(s, categorieParDefaut)),
    [retenus, compris, categorieParDefaut],
  );

  const lancer = useCallback(async () => {
    if (!contexte) return;
    setCalcul(true);
    setErreur(null);
    try {
      setReponse(await simulerScenarios(contexte.base, variantes));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "La simulation a échoué.");
    } finally {
      setCalcul(false);
    }
  }, [contexte, variantes]);

  // Toute modification de ce qui est retenu relance le calcul : l'écran n'affiche jamais
  // des chiffres qui ne correspondent plus à ce qui est coché au-dessus.
  useEffect(() => {
    if (contexte) void lancer();
  }, [contexte, lancer]);

  const scenarios = useMemo(() => reponse?.scenarios ?? [], [reponse]);
  const synthese = useMemo(() => construireSynthese(factures, "12m"), [factures]);
  const projection = useMemo(
    () => construireProjection(synthese.points, scenarios, reponse?.plafonds ?? []),
    [synthese.points, scenarios, reponse?.plafonds],
  );
  const decompositions = useMemo(() => construireDecomposition(scenarios), [scenarios]);
  const provisions = useMemo(() => construireProvisions(scenarios), [scenarios]);
  const ecarts = useMemo(() => construireEcarts(scenarios), [scenarios]);
  const depassements = useMemo(() => depassementsParScenario(scenarios), [scenarios]);
  const avertissements = useMemo(() => avertissementsUniques(scenarios), [scenarios]);

  // L'analyse détaillée porte sur le scénario le plus parlant : le premier retenu si
  // l'utilisateur en a choisi un, la situation actuelle sinon.
  const scenarioAnalyse = scenarios[1] ?? scenarios[0] ?? null;
  const flux = useMemo(() => construireFluxEuro(scenarioAnalyse), [scenarioAnalyse]);
  const cascade = useMemo(() => construireCascade(scenarioAnalyse), [scenarioAnalyse]);
  const comparaison = useMemo(
    () => construireComparaisonOption(scenarioAnalyse),
    [scenarioAnalyse],
  );
  const etapes = useMemo(() => etapesCalcul(scenarioAnalyse), [scenarioAnalyse]);
  const sources = useMemo(() => lireProvenance(scenarioAnalyse), [scenarioAnalyse]);

  const champsManquants = useMemo(
    () => reponse?.champs_manquants ?? contexte?.champs_manquants ?? [],
    [reponse, contexte],
  );

  // Les recommandations croisent les sorties du moteur avec les factures réelles : c'est
  // ce croisement, et lui seul, qui distingue un conseil d'un lieu commun.
  const recommandations = useMemo(
    () =>
      construireRecommandations({
        scenario: scenarioAnalyse,
        ecart: ecarts.find((e) => e.id === scenarioAnalyse?.id),
        provision: provisions.find((p) => p.id === scenarioAnalyse?.id),
        projection,
        synthese,
        factures,
        champsManquants,
      }),
    [scenarioAnalyse, ecarts, provisions, projection, synthese, factures, champsManquants],
  );

  const provisionAnalysee = provisions.find((p) => p.id === scenarioAnalyse?.id);

  const verdict = useMemo(
    () =>
      construireVerdict(
        scenarioAnalyse,
        ecarts.find((e) => e.id === scenarioAnalyse?.id),
        recommandations,
      ),
    [scenarioAnalyse, ecarts, recommandations],
  );

  const basculer = (id: string) =>
    setRetenus((liste) =>
      liste.includes(id)
        ? liste.filter((autre) => autre !== id)
        : // Le plafond des teintes catégorielles validées borne la comparaison.
          liste.length >= 3
          ? liste
          : [...liste, id],
    );

  const corrigerCategorie = (id: string, categorie: CategorieFiscale) =>
    setCompris((liste) =>
      liste.map((scenario) =>
        scenario.id !== id
          ? scenario
          : {
              ...scenario,
              categorie,
              // La valeur devient explicite : elle vient désormais de l'utilisateur.
              elements: (scenario.elements ?? []).map((element) =>
                element.champ !== "categorie"
                  ? element
                  : {
                      ...element,
                      provenance: "explicite" as const,
                      libelle: LIBELLE_COURT[categorie],
                    },
              ),
            },
      ),
    );

  return (
    <AppShell>
      <PageHeader
        eyebrow="Scénarios"
        title={
          <>
            Et si je signais <span className="italic font-normal">ce contrat ?</span>
          </>
        }
        description="Décrivez la situation en français simple, on vous montre l'impact fiscal, ligne par ligne."
      />

      {erreur && (
        <div className="animate-rise mb-6 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">{erreur}</p>
        </div>
      )}

      {chargement ? (
        <ChargementEcran />
      ) : !contexte ? (
        <EtatIndisponible />
      ) : (
        <div className="space-y-8">
          {/* --- Temps 1 : ce que j'ai compris ------------------------------------ */}
          <ScenarioSaisie
            phrase={phrase}
            onPhraseChange={setPhrase}
            scenarios={compris}
            retenus={retenus}
            onBasculerScenario={basculer}
            onCorrigerCategorie={corrigerCategorie}
            onInterpretation={(liste, texte) => {
              setCompris(liste);
              setResume(texte);
              // Ce que la phrase décrit est retenu d'office ; les suggestions, non :
              // l'utilisateur ne doit jamais subir des chiffres qu'il n'a pas demandés.
              setRetenus(liste.filter((s) => !s.propose).slice(0, 3).map((s) => s.id));
            }}
            resume={resume}
            desactive={calcul}
          />

          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {calcul && <Loader2 className="size-3.5 animate-spin" />}
            {contexte.ca_source} · {contexte.nb_factures_prises_en_compte} facture
            {contexte.nb_factures_prises_en_compte > 1 ? "s" : ""} prise
            {contexte.nb_factures_prises_en_compte > 1 ? "s" : ""} en compte pour {contexte.annee}.
          </p>

          {champsManquants.length > 0 && <BlocNonCalculable champs={champsManquants} />}

          {calcul && reponse === null ? (
            <ChargementResultats />
          ) : scenarios.length === 0 ? null : (
            <>
              {/* 1 · La réponse — deux chiffres et une phrase. */}
              {verdict && (
                <CarteVerdict
                  verdict={verdict}
                  provisionMensuelle={
                    provisionAnalysee?.parMois != null
                      ? formatEuros(provisionAnalysee.parMois)
                      : null
                  }
                />
              )}

              {/* 2 · Les figures, une à la fois — elles s'affichent DÈS le premier
                     scénario, ce qui n'était plus le cas. */}
              <PanneauFigures
                cascade={cascade}
                cascadeComplete={flux?.complet ?? false}
                projection={projection}
                decompositions={decompositions}
                comparaison={comparaison}
                nbScenarios={scenarios.length}
              />

              {/* 3 · Ce qu'il faut vérifier — trois points au plus, le reste sur demande. */}
              {recommandations.length > 0 && (
                <section className="space-y-4">
                  <div>
                    <h2 className="text-lg">Ce qu'il faut vérifier</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Croisement des calculs avec vos factures et votre profil.
                    </p>
                  </div>
                  <ListeRecommandations recommandations={recommandations} />
                </section>
              )}

              {/* 4 · Tout le reste, replié : le détail ne doit encombrer que ceux qui
                     le demandent. */}
              <DetailCalcul
                etapes={etapes}
                sources={sources}
                titre={
                  scenarioAnalyse
                    ? `Comment « ${scenarioAnalyse.libelle} » est calculé`
                    : "Comment ce chiffre est obtenu"
                }
              />

              <BlocDetail
                scenarios={scenarios}
                ecarts={ecarts}
                depassements={depassements}
                scenarioAnalyse={scenarioAnalyse}
                avertissements={avertissements}
              />
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}

const LIBELLE_COURT: Record<CategorieFiscale, string> = {
  BIC_VENTE: "vente de marchandises",
  BIC_SERVICE: "prestation commerciale",
  BNC: "prestation libérale",
};

/**
 * Le reste, replié.
 *
 * Tableau chiffré, abattement et avertissements du moteur : ces trois blocs occupaient
 * l'écran principal alors qu'ils ne servent qu'à celui qui veut vérifier. Les replier n'est
 * pas les cacher — c'est cesser de les imposer à quelqu'un qui cherchait juste un montant.
 */
function BlocDetail({
  scenarios,
  ecarts,
  depassements,
  scenarioAnalyse,
  avertissements,
}: {
  scenarios: ReponseScenarios["scenarios"];
  ecarts: ReturnType<typeof construireEcarts>;
  depassements: ReturnType<typeof depassementsParScenario>;
  scenarioAnalyse: ReponseScenarios["scenarios"][number] | null;
  avertissements: string[];
}) {
  const [ouvert, setOuvert] = useState(false);

  return (
    <section className="animate-rise overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        className="flex w-full items-center justify-between gap-3 p-5 text-left transition-colors hover:bg-secondary/40"
      >
        <span className="flex items-center gap-2">
          <Table2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">Les chiffres en détail</span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            ouvert && "rotate-180",
          )}
        />
      </button>

      {ouvert && (
        <div className="space-y-6 border-t border-border p-5">
          {scenarioAnalyse && (
            <RepereAbattement
              lignes={scenarioAnalyse.resultat.lignes ?? []}
              caTotal={scenarioAnalyse.resultat.ca_total}
            />
          )}

          <TableauComparatif
            scenarios={scenarios}
            ecarts={ecarts}
            depassements={depassements}
          />

          {avertissements.length > 0 && (
            <div className="rounded-xl border border-border bg-secondary/40 p-4">
              <p className="rule-label text-muted-foreground">Ce que le moteur signale</p>
              <ul className="mt-3 space-y-2">
                {avertissements.map((message) => (
                  <li key={message} className="text-xs leading-relaxed text-muted-foreground">
                    {message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * L'écart entre deux scénarios est le vrai sujet : la courbe le montre, ce tableau le
 * chiffre.
 */
function TableauComparatif({
  scenarios,
  ecarts,
  depassements,
}: {
  scenarios: ReponseScenarios["scenarios"];
  ecarts: ReturnType<typeof construireEcarts>;
  depassements: ReturnType<typeof depassementsParScenario>;
}) {
  return (
    <section className="animate-rise overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Comparaison chiffrée des scénarios : net perçu, prélèvements et écart face à la
            situation actuelle
          </caption>
          <thead className="border-b border-border bg-secondary/50">
            <tr>
              <th scope="col" className="rule-label px-5 py-3.5 text-left text-muted-foreground">
                Scénario
              </th>
              {["CA", "Net perçu", "Prélèvements", "Taux", "Écart net"].map((h) => (
                <th key={h} scope="col" className="rule-label px-5 py-3.5 text-right text-muted-foreground">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {scenarios.map((scenario, index) => {
              const ecart = ecarts.find((e) => e.id === scenario.id);
              const depasse = depassements.some((d) => d.id === scenario.id);
              const r = scenario.resultat;
              return (
                <tr key={scenario.id} className="transition-colors duration-150 hover:bg-secondary/40">
                  <th scope="row" className="px-5 py-3.5 text-left font-medium">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block size-2.5 shrink-0 rounded-[3px]"
                        style={{ background: couleurSerie(index) }}
                      />
                      {scenario.libelle}
                      {depasse && (
                        <span className="rule-label text-destructive">plafond dépassé</span>
                      )}
                    </span>
                  </th>
                  <td className="num px-5 py-3.5 text-right text-muted-foreground">
                    {formatEuros(r.ca_total)}
                  </td>
                  <td className="num px-5 py-3.5 text-right font-medium">
                    {formatEuros(r.revenu_net_estime)}
                  </td>
                  <td className="num px-5 py-3.5 text-right text-amber-fiscal">
                    {formatEuros(r.total_prelevements)}
                  </td>
                  <td className="num px-5 py-3.5 text-right text-muted-foreground">
                    {r.taux_effectif == null ? "—" : formatPct(r.taux_effectif * 100)}
                  </td>
                  <td className="num px-5 py-3.5 text-right text-teal-dark">
                    {index === 0
                      ? "—"
                      : ecart?.deltaNet == null
                        ? "—"
                        : `${ecart.deltaNet >= 0 ? "+ " : "− "}${formatEuros(Math.abs(ecart.deltaNet))}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Le cas le plus important de l'écran. Sans parts fiscales ni autres revenus, le moteur
 * REFUSE de calculer l'impôt — et un « 0 € » se lirait « vous ne paierez rien ». On nomme
 * donc ce qui manque, et on dit précisément ce que ça empêche.
 */
function BlocNonCalculable({
  champs,
}: {
  champs: { champ: string; libelle: string; consequence: string }[];
}) {
  return (
    <section className="animate-rise rounded-2xl border border-warning/40 bg-warning/10 p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-warning-ink">
        <CircleAlert className="size-4 shrink-0" />
        Certains montants ne sont pas calculés
      </h2>
      <ul className="mt-3 space-y-2">
        {champs.map((champ) => (
          <li key={champ.champ} className="text-xs leading-relaxed text-warning-ink">
            <strong>{champ.libelle}</strong> — {champ.consequence}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-warning-ink">
        Les cotisations sociales et la formation professionnelle, elles, restent calculées :
        elles ne dépendent pas du foyer.
      </p>
      <div className="mt-4">
        <Link
          to="/parametres"
          className="inline-flex h-9 items-center justify-center rounded-xl border border-warning/50 px-4 text-xs font-medium text-warning-ink transition-colors hover:border-warning"
        >
          Compléter mon profil fiscal
        </Link>
      </div>
    </section>
  );
}

function ChargementEcran() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-56 w-full rounded-2xl" />
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}

function ChargementResultats() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}

function EtatIndisponible() {
  return (
    <div className="animate-rise rounded-2xl border border-border bg-card p-10 text-center shadow-soft">
      <h2 className="text-xl">Simulation indisponible</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        Le contexte de simulation n'a pas pu être chargé. Vérifiez votre connexion, puis
        rechargez la page.
      </p>
    </div>
  );
}
