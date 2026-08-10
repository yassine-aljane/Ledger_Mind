/**
 * Rapport fiscal — le chiffre d'affaires ENCAISSÉ, rapproché virement par virement.
 *
 * Deux modes, jamais confondus visuellement :
 *   • Déclaration — seuls les encaissements rapprochés comptent. C'est l'assiette réelle.
 *   • Projection  — fondée sur les factures émises, encaissées ou non. NON déclarative,
 *     et l'écran le dit en permanence plutôt qu'en note de bas de page.
 *
 * Aucun calcul n'est fait ici : chaque montant vient du moteur d'impôt via l'API. Un champ
 * `null` s'affiche « non calculé » et jamais « 0 » — un calcul refusé ne doit pas se lire
 * comme un résultat nul.
 */

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  ChevronDown,
  CircleAlert,
  Download,
  FileWarning,
  Info,
  Loader2,
  Receipt,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  contextePrerempli,
  genererRapportFiscal,
  listerRapportsFiscaux,
  obtenirRapportFiscal,
  supprimerRapportFiscal,
  telechargerRapportFiscalPdf,
  type Alerte,
  type ContextePrerempli,
  type ContexteFiscalRapport,
  type FactureNonSoldee,
  type OrigineChamp,
  type RapportArchive,
  type RapportFiscal,
} from "@/lib/rapport-fiscal-api";

// --------------------------------------------------------------------------------- formats

/** `null` veut dire « non calculé ». L'afficher « 0 € » se lirait comme « rien à payer ». */
function eur(montant: number | null | undefined): string {
  if (montant === null || montant === undefined) return "non calculé";
  return montant.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function pourcent(taux: number | null | undefined): string {
  if (taux === null || taux === undefined) return "non calculé";
  return `${(taux * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

function dateFr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, j] = String(iso).slice(0, 10).split("-");
  return a && m && j ? `${j}/${m}/${a}` : String(iso);
}

function debutAnneeIso() {
  return `${new Date().getFullYear()}-01-01`;
}
function aujourdHuiIso() {
  return new Date().toISOString().slice(0, 10);
}

// ------------------------------------------------------------------------------- primitives

function Carte({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-6", className)}>
      {children}
    </section>
  );
}

function Rubrique({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="rule-label text-muted-foreground">{titre}</h3>
      {children}
    </div>
  );
}

function LigneChiffre({
  libelle,
  valeur,
  fort,
  aide,
}: {
  libelle: string;
  valeur: string;
  fort?: boolean;
  aide?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <span className={cn("text-sm", fort ? "font-medium text-ink" : "text-muted-foreground")}>
        {libelle}
        {aide && <span className="ml-1 text-xs text-muted-foreground/70">· {aide}</span>}
      </span>
      <span
        className={cn(
          "num tabular-nums whitespace-nowrap",
          fort ? "text-base font-semibold" : "text-sm",
          valeur === "non calculé" && "text-xs font-normal italic text-muted-foreground",
        )}
      >
        {valeur}
      </span>
    </div>
  );
}

const STYLE_ALERTE: Record<Alerte["niveau"], { boite: string; Icone: typeof Info }> = {
  critique: { boite: "border-destructive/30 bg-destructive/10 text-destructive", Icone: CircleAlert },
  vigilance: { boite: "border-amber-fiscal/40 bg-amber-fiscal/10 text-ink", Icone: AlertTriangle },
  info: { boite: "border-border bg-secondary/40 text-ink", Icone: Info },
};

function BlocAlerte({ alerte }: { alerte: Alerte }) {
  const { boite, Icone } = STYLE_ALERTE[alerte.niveau];
  return (
    <div className={cn("flex gap-3 rounded-xl border p-4", boite)}>
      <Icone className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">{alerte.titre}</p>
        <p className="text-xs leading-relaxed opacity-90">{alerte.message}</p>
        {alerte.source && (
          <a
            href={alerte.source}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs underline opacity-70 hover:opacity-100"
          >
            Source officielle
          </a>
        )}
      </div>
    </div>
  );
}

function Depliant({
  titre,
  compte,
  children,
  accent,
}: {
  titre: string;
  compte: number;
  children: React.ReactNode;
  accent?: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  if (compte === 0) return null;
  return (
    <div className="rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          {accent && <FileWarning className="size-4 text-amber-fiscal" />}
          {titre}
          <span className="num rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
            {compte}
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", ouvert && "rotate-180")} />
      </button>
      {ouvert && <div className="space-y-2 border-t border-border px-4 py-3">{children}</div>}
    </div>
  );
}

function LigneFactureDue({ facture }: { facture: FactureNonSoldee }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
      <span className="num font-medium">{facture.numero ?? "—"}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{facture.client ?? "—"}</span>
      <span
        className={cn(
          "text-xs",
          facture.en_retard ? "font-medium text-destructive" : "text-muted-foreground",
        )}
      >
        échéance {dateFr(facture.date_echeance)}
        {facture.en_retard && facture.jours_de_retard !== null && ` · retard ${facture.jours_de_retard} j`}
      </span>
      <span className="num tabular-nums font-medium">{eur(facture.reste_du)}</span>
    </div>
  );
}

// ------------------------------------------------------------------------------- composant

export function RapportFiscalPanel({
  onPeriodeGeneree,
  onSuivant,
}: {
  /** Notifie la période retenue — sert à un écran hôte qui enchaîne sur une autre étape. */
  onPeriodeGeneree?: (debut: string, fin: string) => void;
  /** Bouton de suite, affiché seulement si l'hôte en fournit un. */
  onSuivant?: () => void;
} = {}) {
  const [dateDebut, setDateDebut] = useState(debutAnneeIso());
  const [dateFin, setDateFin] = useState(aujourdHuiIso());
  const [contexte, setContexte] = useState<ContexteFiscalRapport>({
    caisse_bnc: "REGIME_GENERAL",
    categorie_par_defaut: "BNC",
  });
  const [prefill, setPrefill] = useState<ContextePrerempli | null>(null);
  const [rapport, setRapport] = useState<RapportFiscal | null>(null);
  const [archives, setArchives] = useState<RapportArchive[]>([]);
  const [chargement, setChargement] = useState(false);
  const [exportEnCours, setExportEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // Préremplissage depuis l'onboarding : l'utilisateur a déjà répondu à ces questions, les
  // reposer serait une double saisie — et deux saisies du même fait finissent par diverger.
  useEffect(() => {
    contextePrerempli()
      .then((p) => {
        setPrefill(p);
        if (p.contexte) setContexte(p.contexte);
      })
      .catch(() => {});
    rechargerArchives();
  }, []);

  function rechargerArchives() {
    listerRapportsFiscaux()
      .then((r) => setArchives(r.rapports))
      .catch(() => {});
  }

  async function generer(e: React.FormEvent) {
    e.preventDefault();
    setChargement(true);
    setErreur(null);
    try {
      const r = await genererRapportFiscal(dateDebut, dateFin, contexte);
      setRapport(r);
      onPeriodeGeneree?.(dateDebut, dateFin);
      rechargerArchives();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Génération du rapport impossible.");
    } finally {
      setChargement(false);
    }
  }

  async function exporter(id: string, debut: string, fin: string) {
    setExportEnCours(id);
    setErreur(null);
    try {
      await telechargerRapportFiscalPdf(id, debut, fin);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Export PDF impossible.");
    } finally {
      setExportEnCours(null);
    }
  }

  async function ouvrirArchive(id: string) {
    setErreur(null);
    try {
      setRapport(await obtenirRapportFiscal(id));
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Rapport introuvable.");
    }
  }

  async function supprimerArchive(id: string) {
    setErreur(null);
    try {
      await supprimerRapportFiscal(id);
      if (rapport?.id === id) setRapport(null);
      rechargerArchives();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Suppression impossible.");
    }
  }

  const rap = rapport?.rapprochement ?? null;
  const sim = rapport?.simulation ?? null;
  const src = rapport?.sources ?? null;
  const incertain = rap ? Math.round((rap.ca_encaisse - rap.ca_encaisse_certain) * 100) / 100 : 0;
  const ecartFacture = rapport
    ? Math.round((rapport.ca_facture_periode - rapport.ca_retenu) * 100) / 100
    : 0;

  return (
    <div className="grid items-start gap-8 lg:grid-cols-12">
      {/* ---------------------------------------------------------------- paramètres */}
      <div className="space-y-6 lg:col-span-5 lg:sticky lg:top-24">
        <form onSubmit={generer} className="space-y-6 rounded-2xl border border-border bg-card p-6">
          {prefill?.profil_disponible && (
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-4 text-sm">
              <span className="font-medium">{prefill.denomination ?? "Votre activité"}</span>
              <span className="text-xs text-muted-foreground">
                SIREN {prefill.siren ?? "—"} · {prefill.regime ?? "régime en cours de qualification"}
              </span>
            </div>
          )}

          <Rubrique titre="Période">
            <div className="grid grid-cols-2 gap-4">
              <ChampDate libelle="Du" valeur={dateDebut} onChange={setDateDebut} />
              <ChampDate libelle="Au" valeur={dateFin} onChange={setDateFin} />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              L'assiette retenue est le chiffre d'affaires <strong>encaissé</strong> : seuls les
              virements reçus et rattachés à une facture comptent. Une facture émise et non payée
              comptera pour la période de son encaissement.
            </p>
          </Rubrique>

          <ContexteFoyer
            contexte={contexte}
            origine={prefill?.origine ?? {}}
            onChange={setContexte}
          />

          {prefill && prefill.champs_bloquants.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-amber-fiscal/40 bg-amber-fiscal/10 p-4">
              <p className="text-sm font-semibold">Ce qui ne pourra pas être calculé</p>
              <ul className="space-y-1 text-xs leading-relaxed">
                {prefill.champs_bloquants.map((c) => (
                  <li key={c.champ}>
                    <span className="font-medium">{c.libelle}</span> — {c.consequence}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="submit"
            disabled={chargement}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 text-sm font-medium text-accent-ink shadow-soft transition-all hover:brightness-[1.04] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {chargement ? <Loader2 className="size-4 animate-spin" /> : <Receipt className="size-4" />}
            {chargement ? "Rapprochement en cours…" : "Établir le rapport"}
          </button>
        </form>

        {erreur && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm font-medium text-destructive">
            {erreur}
          </div>
        )}

      </div>

      {/* ------------------------------------------------------------------ résultat */}
      <div className="space-y-6 lg:col-span-7">
        {!rapport ? (
          // Tant qu'aucun rapport n'est ouvert, cet espace sert à retrouver les précédents —
          // c'est ce qu'on vient chercher le plus souvent, bien plus qu'un texte d'attente.
          <HistoriqueRapports
            archives={archives}
            actifId={null}
            exportEnCours={exportEnCours}
            onOuvrir={ouvrirArchive}
            onTelecharger={exporter}
            onSupprimer={supprimerArchive}
          />
        ) : (
          <>
            {/* Un rapport ouvert masque la liste : ce lien y ramène. */}
            <button
              type="button"
              onClick={() => setRapport(null)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-ink"
            >
              <ArrowLeft className="size-4" /> Tous les rapports établis
            </button>

            {/* Assiette */}
            <Carte className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="rule-label text-muted-foreground">Chiffre d'affaires encaissé</p>
                  <p className="num mt-1 text-4xl font-semibold tabular-nums sm:text-5xl">
                    {eur(rapport.ca_retenu)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    du {dateFr(rapport.date_debut)} au {dateFr(rapport.date_fin)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => exporter(rapport.id, rapport.date_debut, rapport.date_fin)}
                  disabled={exportEnCours !== null}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm font-medium transition-colors hover:border-ink disabled:opacity-40"
                >
                  {exportEnCours === rapport.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  PDF
                </button>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                {rapport.base_de_calcul}
              </p>

              {rap && (
                <div className="space-y-1 pt-1">
                  <LigneChiffre
                    libelle="Rattaché avec certitude"
                    aide="n° de facture dans le libellé"
                    valeur={eur(rap.ca_encaisse_certain)}
                  />
                  {incertain > 0 && (
                    <LigneChiffre
                      libelle="Rattaché par montant et date"
                      aide="à confirmer"
                      valeur={eur(incertain)}
                    />
                  )}
                  {/* Deux natures de recette dans une même assiette : l'une figure sur un
                      relevé bancaire, l'autre non. */}
                  {rapport.ca_avantages_en_nature > 0 && (
                    <>
                      <LigneChiffre
                        libelle="dont encaissements bancaires"
                        valeur={eur(rapport.ca_encaisse_bancaire)}
                      />
                      <LigneChiffre
                        libelle="dont avantages en nature"
                        aide="hors relevé bancaire"
                        valeur={eur(rapport.ca_avantages_en_nature)}
                      />
                    </>
                  )}
                  {/* Indicateur, jamais assiette : facturer n'est pas encaisser. */}
                  <LigneChiffre
                    libelle="Facturé sur la période"
                    aide="pour information"
                    valeur={eur(rapport.ca_facture_periode)}
                  />
                  {Math.abs(ecartFacture) > 0.01 && (
                    <LigneChiffre
                      libelle="Écart facturé − encaissé"
                      aide={
                        ecartFacture > 0
                          ? "facturé non encore rentré"
                          : "encaissements de périodes antérieures"
                      }
                      valeur={eur(ecartFacture)}
                    />
                  )}
                </div>
              )}

              {rap && Object.keys(rap.ca_par_categorie).length > 1 && (
                <div className="space-y-1 pt-1">
                  {Object.entries(rap.ca_par_categorie).map(([nature, montant]) => (
                    <LigneChiffre key={nature} libelle={`Ventilation — ${nature}`} valeur={eur(montant)} />
                  ))}
                </div>
              )}
            </Carte>

            {/* Impôt et cotisations — TOUJOURS affiché : à CA nul, zéro est un résultat. */}
            <Carte className="space-y-4">
              <Rubrique titre="Impôt et cotisations">
                {rapport.categories_fiscales.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {rapport.categories_fiscales.map((c) => (
                      <span
                        key={c}
                        className="num rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
                {sim && (
                  <div className="space-y-1">
                    <LigneChiffre libelle="Base imposable après abattement" valeur={eur(sim.base_imposable)} />
                    <LigneChiffre
                      libelle="Cotisations sociales"
                      aide="assises sur le CA plein"
                      valeur={eur(sim.cotisations_sociales)}
                    />
                    <LigneChiffre libelle="Contribution à la formation" valeur={eur(sim.cfp)} />
                    <LigneChiffre
                      libelle="Impôt sur le revenu imputable"
                      valeur={eur(sim.ir_bareme)}
                    />
                    <LigneChiffre libelle="Total des prélèvements" valeur={eur(sim.total_prelevements)} fort />
                    <LigneChiffre libelle="Revenu net estimé" valeur={eur(sim.revenu_net_estime)} />
                    <LigneChiffre
                      libelle="Taux effectif"
                      valeur={
                        sim.taux_effectif !== null
                          ? pourcent(sim.taux_effectif)
                          : sim.ca_total > 0
                            ? "non calculé"
                            : "non applicable (CA nul)"
                      }
                    />
                  </div>
                )}
                {rapport.ca_retenu <= 0 && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Aucun chiffre d'affaires encaissé sur la période. Les calculs ont bien été
                    effectués avec un chiffre d'affaires nul : tous les montants ci-dessus valent
                    donc 0 €. La déclaration reste obligatoire même à zéro.
                  </p>
                )}
              </Rubrique>

              {sim && sim.lignes.length > 1 && (
                <Rubrique titre="Détail par catégorie">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[26rem] text-sm">
                      <thead>
                        <tr className="rule-label text-muted-foreground">
                          <th className="py-2 text-left font-normal">Catégorie</th>
                          <th className="py-2 text-right font-normal">CA</th>
                          <th className="py-2 text-right font-normal">Abattement</th>
                          <th className="py-2 text-right font-normal">Base</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sim.lignes.map((l) => (
                          <tr key={l.categorie} className="border-t border-border/60">
                            <td className="py-2">{l.categorie}</td>
                            <td className="num py-2 text-right tabular-nums">{eur(l.ca)}</td>
                            <td className="num py-2 text-right tabular-nums">
                              {eur(l.abattement)}
                              <span className="ml-1 text-xs text-muted-foreground">
                                ({pourcent(l.taux_abattement)})
                              </span>
                            </td>
                            <td className="num py-2 text-right tabular-nums">{eur(l.base_imposable)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Rubrique>
              )}

              {sim && (
                <Rubrique titre="Barème ou versement libératoire">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <OptionImpot
                      titre="Barème progressif"
                      montant={eur(sim.ir_bareme)}
                      retenue={sim.option_retenue === "bareme"}
                    />
                    <OptionImpot
                      titre="Versement libératoire"
                      montant={eur(sim.versement_liberatoire.montant)}
                      retenue={!!sim.option_retenue && sim.option_retenue !== "bareme"}
                      indisponible={sim.versement_liberatoire.eligible === false}
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {sim.recommandation ??
                      sim.versement_liberatoire.motif_ineligibilite ??
                      "Comparaison non concluante : l'un des deux montants n'a pas pu être calculé."}
                  </p>
                </Rubrique>
              )}
            </Carte>

            {/* Contrôle du plafond du régime micro */}
            {rapport.plafonds?.plafonds?.length > 0 && (
              <Carte className="space-y-3">
                <Rubrique titre="Contrôle du plafond du régime micro">
                  <div className="space-y-2">
                    {rapport.plafonds.plafonds.map((p) => (
                      <div
                        key={p.categorie}
                        className={cn(
                          "rounded-xl border p-3",
                          p.conforme
                            ? "border-border bg-background"
                            : "border-destructive/30 bg-destructive/10",
                        )}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="num text-sm font-medium">{p.categorie}</span>
                          <span
                            className={cn(
                              "text-xs font-semibold",
                              p.conforme ? "text-muted-foreground" : "text-destructive",
                            )}
                          >
                            {p.conforme ? "✓ Conforme au régime micro" : "⚠ Dépassement du plafond"}
                          </span>
                        </div>
                        <div className="mt-1 space-y-0.5">
                          <LigneChiffre
                            libelle="Plafond applicable"
                            aide={p.plafond_proratise ? "proratisé" : undefined}
                            valeur={eur(p.plafond)}
                          />
                          <LigneChiffre libelle="Chiffre d'affaires encaissé" valeur={eur(p.ca)} />
                          {p.conforme && (
                            <LigneChiffre libelle="Marge restante" valeur={eur(p.marge_restante)} />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {rapport.plafonds.note}
                  </p>
                </Rubrique>
              </Carte>
            )}

            {/* Prorata de première année */}
            {rapport.prorata?.applique && (
              <Carte className="space-y-3">
                <Rubrique titre="Prorata de première année">
                  <div className="space-y-1">
                    <LigneChiffre
                      libelle="Date de création de l'activité"
                      valeur={dateFr(rapport.prorata.date_creation)}
                    />
                    <LigneChiffre
                      libelle="Jours d'activité"
                      valeur={String(rapport.prorata.jours_activite ?? "—")}
                    />
                    <LigneChiffre libelle="Méthode" valeur={rapport.prorata.methode ?? "—"} />
                    {rapport.prorata.plafonds_proratises.map((p) => (
                      <LigneChiffre
                        key={p.categorie}
                        libelle={`Plafond proratisé — ${p.categorie}`}
                        valeur={eur(p.plafond)}
                      />
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {rapport.prorata.note}
                  </p>
                </Rubrique>
              </Carte>
            )}

            {/* ACRE */}
            {rapport.acre && (
              <Carte className="space-y-3">
                <Rubrique titre="Aide à la création d'entreprise (ACRE)">
                  <div className="space-y-1">
                    <LigneChiffre
                      libelle="ACRE"
                      valeur={rapport.acre.active ? "Oui" : "Non"}
                      fort
                    />
                    <LigneChiffre
                      libelle="Réduction des cotisations sociales"
                      valeur={`${rapport.acre.reduction_pourcent} %`}
                    />
                    {rapport.acre.active && (
                      <>
                        <LigneChiffre
                          libelle="Début de l'exonération"
                          valeur={dateFr(rapport.acre.date_debut)}
                        />
                        <LigneChiffre
                          libelle="Trimestres civils restants"
                          valeur={
                            rapport.acre.trimestres_restants === null
                              ? "indéterminé"
                              : String(rapport.acre.trimestres_restants)
                          }
                        />
                        <LigneChiffre
                          libelle="Fin estimée"
                          valeur={dateFr(rapport.acre.date_fin_estimee)}
                        />
                      </>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {[rapport.acre.note, rapport.acre.hypothese].filter(Boolean).join(" ")}
                  </p>
                </Rubrique>
              </Carte>
            )}

            {/* TVA — drapeau seul */}
            {rapport.tva?.lignes?.length > 0 && (
              <Carte className="space-y-3">
                <Rubrique titre="Franchise en base de TVA">
                  {rapport.tva.libelle_statut && (
                    <p
                      className={cn(
                        "text-sm font-semibold",
                        rapport.tva.statut === "franchise_conservee"
                          ? "text-muted-foreground"
                          : "text-destructive",
                      )}
                    >
                      {rapport.tva.statut === "franchise_conservee" ? "✓ " : "⚠ "}
                      {rapport.tva.libelle_statut}
                    </p>
                  )}
                  <div className="space-y-1">
                    {rapport.tva.lignes.map((l) => (
                      <LigneChiffre
                        key={l.nature}
                        libelle={`${l.libelle} — ${eur(l.ca)}`}
                        valeur={
                          l.depasse_majore
                            ? "seuil majoré dépassé"
                            : l.depasse_base
                              ? "seuil de base dépassé"
                              : `reste ${eur(l.reste_avant_base)}`
                        }
                      />
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{rapport.tva.note}</p>
                </Rubrique>
              </Carte>
            )}

            {/* Alertes */}
            {rapport.alertes.length > 0 && (
              <Carte className="space-y-3">
                <Rubrique titre="Points d'attention">
                  <div className="space-y-2">
                    {rapport.alertes.map((a, i) => (
                      <BlocAlerte key={`${a.titre}-${i}`} alerte={a} />
                    ))}
                  </div>
                </Rubrique>
              </Carte>
            )}

            {/* Détail du rapprochement */}
            {rap && (
              <Carte className="space-y-3">
                <Rubrique titre="Détail du rapprochement">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Chaque euro retenu remonte à un virement précis : c'est la pièce justificative
                    de l'assiette déclarée.
                  </p>
                  <div className="space-y-2">
                    <Depliant titre="Encaissements retenus" compte={rap.encaissements.length}>
                      {rap.encaissements.map((e) => (
                        <div
                          key={`${e.virement_document_id}-${e.facture_numero ?? ""}`}
                          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
                        >
                          <span className="text-xs text-muted-foreground">{dateFr(e.date_valeur)}</span>
                          <span className="num font-medium">{e.facture_numero ?? "—"}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                            {e.libelle ?? "sans libellé"}
                          </span>
                          {e.certain ? (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <BadgeCheck className="size-3.5" /> n° de facture
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-fiscal">
                              <AlertTriangle className="size-3.5" /> à confirmer
                            </span>
                          )}
                          <span className="num text-right tabular-nums font-medium">
                            {eur(e.montant_ht)}
                            {/* Reçu TTC ≠ chiffre d'affaires : la TVA collectée n'est pas un
                                revenu. On ne montre l'écart que lorsqu'il existe. */}
                            {Math.abs(e.montant - e.montant_ht) > 0.005 && (
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                HT · reçu {eur(e.montant)}
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </Depliant>

                    <Depliant
                      titre="Virements écartés du chiffre d'affaires"
                      compte={rap.virements_non_retenus.length}
                      accent
                    >
                      {rap.virements_non_retenus.map((v) => (
                        <div key={v.virement_document_id} className="space-y-1">
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="min-w-0 flex-1 truncate">
                              {v.libelle ?? "sans libellé"}
                              <span className="ml-2 text-xs text-muted-foreground">
                                {dateFr(v.date_valeur)}
                              </span>
                            </span>
                            <span className="num tabular-nums font-medium">{eur(v.montant)}</span>
                          </div>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {v.motif}
                            {v.action_suggeree && ` ${v.action_suggeree}`}
                          </p>
                        </div>
                      ))}
                    </Depliant>

                    {/* Ne pas les compter est correct ; les taire laissait l'utilisateur
                        devant un CA nul inexplicable alors qu'un virement était à un jour
                        de la borne. */}
                    <Depliant
                      titre="Virements hors de la période analysée"
                      compte={rap.virements_hors_periode?.length ?? 0}
                    >
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Datés en dehors de la période, ils relèvent d'un autre exercice et ne
                        sont pas comptés. Si l'un d'eux vous concerne, élargissez la période.
                      </p>
                      {(rap.virements_hors_periode ?? []).map((v) => (
                        <div
                          key={v.virement_document_id}
                          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
                        >
                          <span className="text-xs text-muted-foreground">{dateFr(v.date)}</span>
                          <span className="min-w-0 flex-1 truncate text-xs">
                            {v.libelle ?? "sans libellé"}
                          </span>
                          {v.cite_une_facture && (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-fiscal">
                              <AlertTriangle className="size-3.5" /> cite une facture
                            </span>
                          )}
                          <span className="num tabular-nums font-medium">{eur(v.montant)}</span>
                        </div>
                      ))}
                    </Depliant>

                    <Depliant
                      titre="Factures émises non soldées"
                      compte={rap.factures_impayees.length + rap.factures_partielles.length}
                      accent
                    >
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Ces montants ne comptent pas dans le chiffre d'affaires de la période : ils
                        compteront pour celle de leur encaissement.
                      </p>
                      {[...rap.factures_impayees, ...rap.factures_partielles].map((f) => (
                        <LigneFactureDue key={f.facture_id} facture={f} />
                      ))}
                    </Depliant>
                  </div>
                </Rubrique>
              </Carte>
            )}

            {/* Pièces du dossier : elles éclairent, elles n'entrent pas dans l'assiette */}
            {src &&
              (src.contrats.length > 0 ||
                src.depenses.length > 0 ||
                src.cadeaux.length > 0 ||
                src.cadeaux_a_valoriser.length > 0) && (
              <Carte className="space-y-3">
                <Rubrique titre="Pièces prises en compte">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Compteur libelle="Factures émises" valeur={src.factures_emises} />
                    <Compteur libelle="Virements" valeur={src.virements_analyses} />
                    <Compteur libelle="Contrats en cours" valeur={src.contrats_en_cours} />
                    <Compteur libelle="Dépenses" valeur={src.depenses_capturees} />
                    <Compteur libelle="Cadeaux reçus" valeur={src.cadeaux_recus} />
                  </div>

                  <div className="space-y-2">
                    {/* Le seul dépliant dont le contenu ENTRE dans l'assiette. */}
                    <Depliant titre="Avantages en nature comptés" compte={src.cadeaux.length}>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Fiscalement, ce ne sont pas des cadeaux : un partenariat rémunéré en
                        produits est un revenu en nature, déclarable à sa valeur marchande. Ces
                        montants sont <strong>dans</strong> votre chiffre d'affaires, alors
                        qu'ils n'apparaissent sur aucun relevé bancaire.
                      </p>
                      {src.cadeaux.map((c) => (
                        <div
                          key={c.document_id}
                          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
                        >
                          <span className="text-xs text-muted-foreground">{dateFr(c.date)}</span>
                          <span className="min-w-0 flex-1 truncate">
                            {c.description ?? "—"}
                            {c.marque && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                · {c.marque}
                              </span>
                            )}
                          </span>
                          {c.contrepartie && (
                            <span className="text-xs text-muted-foreground">
                              {c.contrepartie}
                            </span>
                          )}
                          <span className="num tabular-nums font-medium">
                            {eur(c.valeur_eur)}
                          </span>
                        </div>
                      ))}
                      <div className="border-t border-border pt-2">
                        <LigneChiffre
                          libelle="Total des avantages en nature"
                          valeur={eur(src.total_cadeaux_eur)}
                        />
                      </div>
                    </Depliant>

                    <Depliant
                      titre="Cadeaux sans valeur retenue"
                      compte={src.cadeaux_a_valoriser.length}
                      accent
                    >
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Non comptés faute de valeur marchande — votre chiffre d'affaires
                        déclaré s'en trouve <strong>minoré</strong>. Valorisez-les dans vos
                        justificatifs avant de déclarer.
                      </p>
                      {src.cadeaux_a_valoriser.map((c) => (
                        <div
                          key={c.document_id}
                          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
                        >
                          <span className="text-xs text-muted-foreground">{dateFr(c.date)}</span>
                          <span className="min-w-0 flex-1 truncate">
                            {c.description ?? "—"}
                            {c.marque && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                · {c.marque}
                              </span>
                            )}
                          </span>
                          {c.valeur_estimee !== null && (
                            <span className="text-xs text-amber-fiscal">
                              estimé {eur(c.valeur_estimee)}
                            </span>
                          )}
                        </div>
                      ))}
                    </Depliant>

                    <Depliant titre="Contrats en cours" compte={src.contrats.length}>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Un contrat engage, il n'encaisse pas : ces montants ne comptent pas dans
                        le chiffre d'affaires. Ils compteront au fil de leurs encaissements.
                      </p>
                      {src.contrats.map((c) => (
                        <div
                          key={c.document_id}
                          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
                        >
                          <span className="font-medium">{c.titre ?? c.contrepartie ?? "—"}</span>
                          <span className="text-xs text-muted-foreground">{c.type ?? "—"}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                            {dateFr(c.date_debut)} →{" "}
                            {c.duree_indeterminee ? "indéterminée" : dateFr(c.date_fin)}
                          </span>
                          <span className="num tabular-nums font-medium">{eur(c.montant_eur)}</span>
                        </div>
                      ))}
                    </Depliant>

                    <Depliant titre="Dépenses capturées" compte={src.depenses.length} accent>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Informatives uniquement. En micro-entreprise, l'abattement forfaitaire
                        remplace la déduction des frais réels : ces montants ne réduisent ni la
                        base imposable, ni l'assiette sociale.
                      </p>
                      {src.depenses.map((d) => (
                        <div
                          key={d.document_id}
                          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
                        >
                          <span className="text-xs text-muted-foreground">{dateFr(d.date)}</span>
                          <span className="min-w-0 flex-1 truncate">{d.fournisseur ?? "—"}</span>
                          <span className="text-xs text-muted-foreground">{d.categorie ?? "—"}</span>
                          <span className="num tabular-nums font-medium">{eur(d.montant_eur)}</span>
                        </div>
                      ))}
                      <div className="border-t border-border pt-2">
                        <LigneChiffre
                          libelle="Total des dépenses"
                          aide="non déductible en micro"
                          valeur={eur(src.total_depenses_eur)}
                        />
                      </div>
                    </Depliant>
                  </div>
                </Rubrique>
              </Carte>
            )}

            {/* Constantes appliquées : le calcul doit être vérifiable, pas seulement plausible */}
            {rapport.parametres?.length > 0 && (
              <Carte className="space-y-3">
                <Rubrique titre="Paramètres appliqués">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[30rem] text-sm">
                      <thead>
                        <tr className="rule-label text-muted-foreground">
                          <th className="py-2 text-left font-normal">Catégorie</th>
                          <th className="py-2 text-right font-normal">Abattement</th>
                          <th className="py-2 text-right font-normal">Cotisations</th>
                          <th className="py-2 text-right font-normal">CFP</th>
                          <th className="py-2 text-right font-normal">Vers. lib.</th>
                          <th className="py-2 text-right font-normal">Plafond CA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rapport.parametres.map((p) => (
                          <tr key={p.categorie} className="border-t border-border/60">
                            <td className="py-2">
                              {p.categorie}
                              {p.caisse_bnc && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  ({p.caisse_bnc})
                                </span>
                              )}
                            </td>
                            <td className="num py-2 text-right tabular-nums">
                              {pourcent(p.taux_abattement)}
                            </td>
                            <td className="num py-2 text-right tabular-nums">
                              {pourcent(p.taux_social)}
                            </td>
                            <td className="num py-2 text-right tabular-nums">
                              {pourcent(p.taux_cfp)}
                            </td>
                            <td className="num py-2 text-right tabular-nums">
                              {pourcent(p.taux_versement_liberatoire)}
                            </td>
                            <td className="num py-2 text-right tabular-nums">
                              {eur(p.plafond_ca)}
                              {p.plafond_proratise && (
                                <span className="ml-1 text-xs text-muted-foreground">prorata</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Ces taux sont ceux effectivement appliqués ci-dessus. Leur provenance et leur
                    date de contrôle figurent ci-dessous.
                  </p>
                </Rubrique>
              </Carte>
            )}

            {/* Hypothèses et provenance */}
            <Carte className="space-y-4">
              <Rubrique titre="Hypothèses retenues">
                <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  {rapport.hypotheses.map((h, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted-foreground/50">—</span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </Rubrique>
              <Rubrique titre="Provenance des taux">
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {Object.entries(rapport.provenance).map(([cle, v]) => (
                    <li key={cle} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-ink">{cle}</span>
                      <span>{v.fichier}</span>
                      {v.annee && <span>· barème {v.annee}</span>}
                      {v.date_verif && <span>· vérifié le {dateFr(v.date_verif)}</span>}
                      {v.verifie === false && (
                        <span className="font-medium text-destructive">
                          · non recoupé avec la source officielle
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </Rubrique>
            </Carte>

            {onSuivant && (
              <button
                type="button"
                onClick={onSuivant}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:border-ink"
              >
                Étape suivante : déclaration <ArrowRight className="size-4" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------ sous-composants

function Compteur({ libelle, valeur }: { libelle: string; valeur: number }) {
  return (
    <div className="rounded-xl bg-background p-3 text-center">
      <p className="num text-lg font-semibold tabular-nums">{valeur}</p>
      <p className="text-xs leading-tight text-muted-foreground">{libelle}</p>
    </div>
  );
}

/**
 * Rapports archivés. Chacun est une PHOTO de sa période : son PDF rend les chiffres du jour
 * de sa génération, pas ceux d'aujourd'hui — sans quoi un rapport de mars changerait
 * silencieusement dès qu'une facture d'avril est corrigée.
 */
function HistoriqueRapports({
  archives,
  actifId,
  exportEnCours,
  onOuvrir,
  onTelecharger,
  onSupprimer,
}: {
  archives: RapportArchive[];
  actifId: string | null;
  exportEnCours: string | null;
  onOuvrir: (id: string) => void;
  onTelecharger: (id: string, debut: string, fin: string) => void;
  onSupprimer: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <h3 className="rule-label text-accent-ink">Rapports établis</h3>
      {archives.length === 0 ? (
        <Carte className="py-8 text-center text-sm text-muted-foreground">
          Aucun rapport pour l'instant.
        </Carte>
      ) : (
        <div className="space-y-2">
          {archives.map((r) => (
            <div
              key={r.id}
              className={cn(
                "rounded-xl border p-4 transition-colors",
                r.id === actifId ? "border-primary/40 bg-primary/5" : "border-border bg-card",
              )}
            >
              <button
                type="button"
                onClick={() => onOuvrir(r.id)}
                className="w-full space-y-1 text-left"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">
                    {dateFr(r.date_debut)} → {dateFr(r.date_fin)}
                  </span>
                  <span className="num tabular-nums text-sm font-semibold">
                    {eur(r.ca_retenu)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  établi le {dateFr(r.genere_le)}
                  {r.alertes.length > 0 && ` · ${r.alertes.length} point(s) d'attention`}
                </p>
              </button>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onTelecharger(r.id, r.date_debut, r.date_fin)}
                  disabled={exportEnCours !== null}
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-dark hover:underline disabled:opacity-40"
                >
                  {exportEnCours === r.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => onSupprimer(r.id)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-3.5" /> Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChampDate({
  libelle,
  valeur,
  onChange,
}: {
  libelle: string;
  valeur: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="rule-label text-muted-foreground">{libelle}</label>
      <input
        type="date"
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full border-b border-border bg-transparent px-0 py-2 text-sm transition-colors focus:border-ink focus:outline-none"
      />
    </div>
  );
}

function OptionImpot({
  titre,
  montant,
  retenue,
  indisponible,
}: {
  titre: string;
  montant: string;
  retenue: boolean;
  indisponible?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        retenue ? "border-primary/40 bg-primary/5" : "border-border",
        indisponible && "opacity-50",
      )}
    >
      <p className="rule-label text-muted-foreground">{titre}</p>
      <p className="num mt-1 text-lg font-semibold tabular-nums">{montant}</p>
      {retenue && <p className="mt-1 text-xs text-primary">Option retenue ici</p>}
      {indisponible && <p className="mt-1 text-xs text-muted-foreground">Non éligible</p>}
    </div>
  );
}

/**
 * Le foyer fiscal ne se devine pas : sans le nombre de parts ni les autres revenus, le moteur
 * REFUSE de calculer l'impôt au barème plutôt que d'afficher un montant inventé. Ce panneau
 * existe pour lever ce refus, pas pour le contourner.
 */
function ContexteFoyer({
  contexte,
  origine,
  onChange,
}: {
  contexte: ContexteFiscalRapport;
  origine: Record<string, OrigineChamp>;
  onChange: (c: ContexteFiscalRapport) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const set = (patch: Partial<ContexteFiscalRapport>) => onChange({ ...contexte, ...patch });

  const reprisDeLOnboarding = Object.values(origine).filter((o) => o === "onboarding").length;

  return (
    <div className="rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-medium">Votre situation</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {reprisDeLOnboarding > 0
            ? `${reprisDeLOnboarding} champ(s) repris de votre parcours`
            : contexte.parts_fiscales
              ? "renseignée"
              : "impôt non calculé sans elle"}
          <ChevronDown className={cn("size-4 transition-transform", ouvert && "rotate-180")} />
        </span>
      </button>

      {ouvert && (
        <div className="space-y-4 border-t border-border px-4 py-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {reprisDeLOnboarding > 0
              ? "Ces valeurs viennent de votre parcours fiscal. Corrigez-les si votre situation a changé : votre correction fait autorité pour ce rapport."
              : "Le barème de l'impôt est progressif : sans le nombre de parts et les autres revenus du foyer, aucun montant honnête ne peut être produit. Les cotisations, elles, restent calculées."}
          </p>

          <div className="grid grid-cols-2 gap-4">
            <ChampNombre
              libelle="Parts fiscales"
              valeur={contexte.parts_fiscales}
              pas={0.5}
              origine={origine.parts_fiscales}
              onChange={(v) => set({ parts_fiscales: v })}
            />
            <ChampNombre
              libelle="Autres revenus du foyer"
              valeur={contexte.autres_revenus}
              origine={origine.autres_revenus}
              onChange={(v) => set({ autres_revenus: v })}
            />
            <ChampNombre
              libelle="RFR de l'année N-2"
              valeur={contexte.rfr_n2}
              origine={origine.rfr_n2}
              onChange={(v) => set({ rfr_n2: v })}
            />
            <div>
              <label className="rule-label text-muted-foreground">Caisse de retraite</label>
              <select
                value={contexte.caisse_bnc ?? "REGIME_GENERAL"}
                onChange={(e) =>
                  set({ caisse_bnc: e.target.value as ContexteFiscalRapport["caisse_bnc"] })
                }
                className="mt-1.5 w-full border-b border-border bg-transparent px-0 py-2 text-sm focus:border-ink focus:outline-none"
              >
                <option value="REGIME_GENERAL">Régime général</option>
                <option value="CIPAV">Cipav</option>
              </select>
            </div>
          </div>

          <div>
            <label className="rule-label text-muted-foreground">Nature de l'activité</label>
            <select
              value={contexte.categorie_par_defaut ?? "BNC"}
              onChange={(e) =>
                set({
                  categorie_par_defaut: e.target
                    .value as ContexteFiscalRapport["categorie_par_defaut"],
                })
              }
              className="mt-1.5 w-full border-b border-border bg-transparent px-0 py-2 text-sm focus:border-ink focus:outline-none"
            >
              <option value="BNC">Prestations libérales (BNC)</option>
              <option value="BIC_SERVICE">Prestations commerciales (BIC)</option>
              <option value="BIC_VENTE">Vente de marchandises (BIC)</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Utilisée pour les prestations. Les ventes sont toujours reconnues comme telles.
            </p>
          </div>

          <div className="space-y-2">
            <Case
              coche={!!contexte.en_couple}
              libelle="Marié ou pacsé"
              onChange={(v) => set({ en_couple: v })}
            />
            <Case
              coche={!!contexte.acre_active}
              libelle="ACRE en cours"
              onChange={(v) => set({ acre_active: v })}
            />
            <Case
              coche={!!contexte.option_versement_liberatoire}
              libelle="Option versement libératoire"
              onChange={(v) => set({ option_versement_liberatoire: v })}
            />
            <Case
              coche={!!contexte.dom}
              libelle="Activité exercée dans un DOM"
              onChange={(v) => set({ dom: v })}
            />
          </div>

          <ChampNombre
            libelle="Jours d'activité (1re année seulement)"
            valeur={contexte.jours_activite}
            onChange={(v) => set({ jours_activite: v })}
          />
        </div>
      )}
    </div>
  );
}

/** Ce que dit un champ vide : question jamais posée, ou réponse « je ne sais pas » assumée. */
const _MENTION_ORIGINE: Record<OrigineChamp, string | null> = {
  onboarding: "repris de votre parcours",
  sans_reponse: "vous aviez répondu « je ne sais pas »",
  non_renseigne: null,
};

function ChampNombre({
  libelle,
  valeur,
  pas,
  origine,
  onChange,
}: {
  libelle: string;
  valeur: number | null | undefined;
  pas?: number;
  origine?: OrigineChamp;
  onChange: (v: number | null) => void;
}) {
  const mention = origine ? _MENTION_ORIGINE[origine] : null;
  return (
    <div>
      <label className="rule-label text-muted-foreground">{libelle}</label>
      {mention && <p className="text-[10px] leading-tight text-muted-foreground/70">{mention}</p>}
      <input
        type="number"
        min={0}
        step={pas ?? 1}
        // Champ vide = « non renseigné », distinct de zéro : c'est cette distinction qui
        // décide si le moteur calcule l'impôt ou refuse de le faire.
        value={valeur ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="num mt-1.5 w-full border-b border-border bg-transparent px-0 py-2 text-sm tabular-nums transition-colors focus:border-ink focus:outline-none"
      />
    </div>
  );
}

function Case({
  coche,
  libelle,
  onChange,
}: {
  coche: boolean;
  libelle: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
      <input
        type="checkbox"
        checked={coche}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-border accent-primary"
      />
      {libelle}
    </label>
  );
}
