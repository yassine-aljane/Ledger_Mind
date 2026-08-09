/**
 * Onglet « Déclaration » — les cinq obligations d'un micro-entrepreneur.
 *
 * Chaque brouillon reproduit le formulaire ou le téléservice officiel, champ par champ, pour
 * être recopié tel quel. Trois principes gouvernent l'affichage :
 *
 *   • **rien n'est transmis** — aucun bouton d'envoi n'existe, la validation reste humaine ;
 *   • **le CA affiché dans les cases est BRUT** — l'administration applique l'abattement ;
 *   • **une référence non recoupée est marquée « à vérifier »** plutôt que présentée comme
 *     fiable. C'est le cas du CA3 aujourd'hui.
 *
 * Aucun montant n'est calculé ici : tout vient du moteur d'impôt via l'API.
 */

import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  Info,
  Loader2,
  Receipt,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  calendrierDeclarations,
  contexteDeclaratif,
  genererDeclarations,
  listerJeuxDeclarations,
  obtenirJeuDeclarations,
  supprimerJeuDeclarations,
  telechargerDocument,
  telechargerDossier,
  type Brouillon,
  type Calendrier,
  type ChampBrouillon,
  type ContexteDeclaratif,
  type ContextePreremplí,
  type Echeance,
  type JeuArchive,
  type JeuDeclarations,
  type Rappel,
  type StatutEcheance,
  type TypeDeclaration,
} from "@/lib/declarations-api";

// --------------------------------------------------------------------------------- formats

function eur(montant: number | null | undefined): string {
  if (montant === null || montant === undefined) return "—";
  return montant.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function pourcent(taux: number | null | undefined): string {
  if (taux === null || taux === undefined) return "—";
  const valeur = taux * 100;
  const decimales = Math.abs(valeur - Math.round(valeur)) < 0.005 ? 0 : valeur >= 1 ? 1 : 3;
  return `${valeur.toFixed(decimales).replace(".", ",")} %`;
}

function dateFr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, j] = String(iso).slice(0, 10).split("-");
  return a && m && j ? `${j}/${m}/${a}` : String(iso);
}

/** Valeur telle qu'elle doit être recopiée sur le site officiel. */
function valeurAffichee(champ: ChampBrouillon): string {
  if (champ.valeur === null || champ.valeur === undefined) return "à compléter";
  if (typeof champ.valeur === "boolean") return champ.valeur ? "Oui" : "Non";
  if (typeof champ.valeur === "number") {
    return champ.unite === "EUR" ? eur(champ.valeur) : String(champ.valeur);
  }
  return String(champ.valeur);
}

const ICONE: Record<TypeDeclaration, typeof FileText> = {
  ca_urssaf: Receipt,
  des: Globe2,
  tva_ca3: FileText,
  revenus_2042: FileText,
  cfe: Building2,
};

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
      <h3 className="rule-label-lg text-label-ink">{titre}</h3>
      {children}
    </div>
  );
}

function LigneChiffre({
  libelle,
  valeur,
  aide,
  fort,
}: {
  libelle: string;
  valeur: string;
  aide?: string;
  fort?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <span className={cn("text-[0.9375rem]", fort ? "font-medium text-ink" : "text-muted-foreground")}>
        {libelle}
        {aide && <span className="ml-1 text-[0.8125rem] text-muted-foreground/70">· {aide}</span>}
      </span>
      <span
        className={cn(
          "num whitespace-nowrap tabular-nums",
          fort ? "text-base font-semibold" : "text-[0.9375rem]",
        )}
      >
        {valeur}
      </span>
    </div>
  );
}

const STYLE_RAPPEL: Record<Rappel["priorite"], { boite: string; Icone: typeof Info }> = {
  haute: { boite: "border-destructive/30 bg-destructive/10 text-destructive", Icone: CircleAlert },
  normale: { boite: "border-amber-fiscal/40 bg-amber-fiscal/10 text-ink", Icone: Calendar },
  info: { boite: "border-border bg-secondary/40 text-ink", Icone: Info },
};

function BlocRappel({ rappel }: { rappel: Rappel }) {
  const { boite, Icone } = STYLE_RAPPEL[rappel.priorite];
  return (
    <div className={cn("flex gap-3 rounded-xl border p-4", boite)}>
      <Icone className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        <p className="text-[0.9375rem] font-semibold">{rappel.titre}</p>
        <p className="text-[0.8125rem] leading-relaxed opacity-90">{rappel.message}</p>
        {rappel.echeance && (
          <p className="text-[0.8125rem] font-medium opacity-80">Échéance : {rappel.echeance}</p>
        )}
        {rappel.lien && (
          <a
            href={rappel.lien}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[0.8125rem] underline opacity-80 hover:opacity-100"
          >
            Site officiel <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </div>
  );
}

/** Une ligne du formulaire, avec sa référence de case et un bouton de recopie. */
function LigneChamp({ champ }: { champ: ChampBrouillon }) {
  const [copie, setCopie] = useState(false);
  const brut =
    typeof champ.valeur === "number" ? String(champ.valeur) : String(champ.valeur ?? "");

  async function copier() {
    try {
      await navigator.clipboard.writeText(brut);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 1500);
    } catch {
      /* presse-papiers indisponible : le montant reste lisible à l'écran */
    }
  }

  return (
    <div className="space-y-1 border-b border-border/60 py-2.5 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex items-baseline gap-2 text-[0.9375rem]">
          {champ.case && (
            <span className="num rounded bg-primary/10 px-1.5 py-0.5 text-[0.8125rem] font-semibold text-primary">
              {champ.case}
            </span>
          )}
          <span>{champ.libelle}</span>
          {champ.fiabilite === "a_verifier" && (
            <span className="inline-flex items-center gap-1 text-[0.8125rem] text-amber-fiscal">
              <AlertTriangle className="size-3" /> à vérifier
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span className="num tabular-nums text-[0.9375rem] font-semibold">{valeurAffichee(champ)}</span>
          {brut && (
            <button
              type="button"
              onClick={copier}
              title="Copier pour le site officiel"
              className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-ink"
            >
              {copie ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          )}
        </span>
      </div>
      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{champ.provenance}</p>
      {champ.note && (
        <p className="text-[0.8125rem] leading-relaxed text-amber-fiscal">{champ.note}</p>
      )}
    </div>
  );
}

function CarteBrouillon({ brouillon }: { brouillon: Brouillon }) {
  const [ouvert, setOuvert] = useState(brouillon.applicable);
  const Icone = ICONE[brouillon.type];

  return (
    <div
      className={cn(
        "rounded-2xl border",
        brouillon.applicable ? "border-border bg-card" : "border-dashed border-border bg-card/50",
      )}
    >
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        className="flex w-full items-start justify-between gap-3 p-5 text-left"
      >
        <span className="flex min-w-0 items-start gap-3">
          <Icone
            className={cn(
              "mt-0.5 size-4 shrink-0",
              brouillon.applicable ? "text-primary" : "text-muted-foreground/50",
            )}
          />
          <span className="min-w-0">
            <span className="block text-[0.9375rem] font-medium">{brouillon.titre}</span>
            <span className="block text-[0.8125rem] text-muted-foreground">
              {brouillon.formulaire
                ? `Formulaire ${brouillon.formulaire}`
                : `Téléservice ${brouillon.teleservice ?? ""}`}
              {" · "}
              {brouillon.frequence}
              {brouillon.applicable
                ? ""
                : " · non applicable"}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {brouillon.montant_a_payer !== null && (
            <span className="num tabular-nums text-[0.9375rem] font-semibold">
              {eur(brouillon.montant_a_payer)}
            </span>
          )}
          <ChevronDown className={cn("size-4 transition-transform", ouvert && "rotate-180")} />
        </span>
      </button>

      {ouvert && (
        <div className="space-y-3 border-t border-border px-5 py-4">
          {!brouillon.applicable ? (
            <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
              {brouillon.motif_non_applicable}
            </p>
          ) : (
            <>
              <div>{brouillon.champs.map((c, i) => <LigneChamp key={i} champ={c} />)}</div>

              {brouillon.points_de_vigilance.length > 0 && (
                <ul className="space-y-1.5 rounded-xl bg-secondary/40 p-3">
                  {brouillon.points_de_vigilance.map((v, i) => (
                    <li key={i} className="flex gap-2 text-[0.8125rem] leading-relaxed">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-fiscal" />
                      <span>{v}</span>
                    </li>
                  ))}
                </ul>
              )}

              {brouillon.lien && (
                <a
                  href={brouillon.lien}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-teal-dark hover:underline"
                >
                  Ouvrir le site officiel pour déclarer <ExternalLink className="size-3" />
                </a>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------- composant

const STATUT_ECHEANCE: Record<StatutEcheance, { libelle: string; classe: string }> = {
  en_retard: { libelle: "En retard", classe: "border-destructive/40 bg-destructive/10 text-destructive" },
  a_faire: { libelle: "À faire", classe: "border-amber-fiscal/50 bg-amber-fiscal/15 text-ink" },
  periode_en_cours: { libelle: "Période en cours", classe: "border-border bg-secondary text-muted-foreground" },
};

export function DeclarationsPanel(_props: {
  periodeInitiale?: { debut: string; fin: string } | null;
}) {
  const [contexte, setContexte] = useState<ContexteDeclaratif>({});
  const [prefill, setPrefill] = useState<ContextePreremplí | null>(null);
  const [calendrier, setCalendrier] = useState<Calendrier | null>(null);
  const [selection, setSelection] = useState<Echeance | null>(null);
  const [jeu, setJeu] = useState<JeuDeclarations | null>(null);
  const [archives, setArchives] = useState<JeuArchive[]>([]);
  const [chargement, setChargement] = useState(false);
  const [export_, setExport] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    contexteDeclaratif()
      .then((p) => {
        setPrefill(p);
        if (p.contexte) setContexte(p.contexte);
      })
      .catch(() => {});
    calendrierDeclarations()
      .then((c) => {
        setCalendrier(c);
        // On ouvre sur la prochaine déclaration due : c'est celle qui presse.
        setSelection(c.prochaine ?? c.echeances[0] ?? null);
      })
      .catch((err) => setErreur(err instanceof Error ? err.message : "Calendrier indisponible."));
    rechargerArchives();
  }, []);

  function rechargerArchives() {
    listerJeuxDeclarations().then((r) => setArchives(r.jeux)).catch(() => {});
  }

  async function preparer(echeance: Echeance) {
    setSelection(echeance);
    setChargement(true);
    setErreur(null);
    try {
      setJeu(await genererDeclarations(
        echeance.periode_debut, echeance.periode_fin, contexte, echeance.type,
      ));
      rechargerArchives();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Préparation impossible.");
    } finally {
      setChargement(false);
    }
  }

  async function exporter(action: () => Promise<void>, cle: string) {
    setExport(cle);
    setErreur(null);
    try {
      await action();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Téléchargement impossible.");
    } finally {
      setExport(null);
    }
  }

  const p = jeu?.prelevements;

  return (
    <div className="grid items-start gap-8 lg:grid-cols-12">
      {/* ---------------------------------------------------------------- paramètres */}
      <div className="space-y-6 lg:col-span-5 lg:sticky lg:top-24">
        <Carte className="space-y-5">
          {prefill?.profil_disponible && (
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-4 text-[0.9375rem]">
              <span className="font-medium">{prefill.denomination ?? "Votre activité"}</span>
              <span className="text-[0.8125rem] text-muted-foreground">SIREN {prefill.siren ?? "—"}</span>
            </div>
          )}

          <Rubrique titre={`Échéances ${calendrier?.annee ?? ""}`}>
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
              Les périodes sont fixées par la réglementation et par votre périodicité{" "}
              <strong>{calendrier?.frequence ?? "—"}</strong>, déclarée lors de votre parcours.
              Elles ne se choisissent pas ici.
            </p>
            {calendrier && (
              <p className="rounded-lg bg-secondary/50 px-3 py-2 text-[0.8125rem] text-muted-foreground">
                <span className="num font-medium text-ink">
                  {eur(calendrier.ca_annuel_encaisse)}
                </span>{" "}
                encaissés sur {calendrier.annee}, toutes périodes confondues.
                {calendrier.ca_annuel_encaisse === 0 &&
                  " Aucun virement reçu n'a été rapproché d'une facture émise."}
              </p>
            )}

            {!calendrier ? (
              <p className="text-[0.9375rem] text-muted-foreground">Chargement du calendrier…</p>
            ) : (
              <div className="space-y-2">
                {calendrier.echeances.map((e) => {
                  const statut = STATUT_ECHEANCE[e.statut];
                  const actif =
                    selection?.type === e.type &&
                    selection?.periode_debut === e.periode_debut;
                  return (
                    <button
                      key={`${e.type}-${e.periode_debut}`}
                      type="button"
                      onClick={() => void preparer(e)}
                      disabled={chargement}
                      className={cn(
                        "w-full rounded-xl border p-3 text-left transition-colors disabled:opacity-50",
                        actif ? "border-primary bg-primary/5" : "border-border hover:border-ink",
                      )}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[0.9375rem] font-medium">{e.libelle}</span>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
                            statut.classe,
                          )}
                        >
                          {statut.libelle}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
                        {e.libelle_periode}
                        {" · "}
                        {e.date_limite
                          ? `avant le ${dateFr(e.date_limite)}`
                          : e.fenetre_indicative}
                      </p>
                      {/* Le CA de la période : sans lui, un « 0 € » se lit comme une panne
                          alors que le chiffre d'affaires est simplement sur un autre
                          trimestre. */}
                      {e.type === "ca_urssaf" && (
                        <p
                          className={cn(
                            "num mt-1 text-[0.8125rem] tabular-nums",
                            e.ca_encaisse > 0 ? "font-medium text-ink" : "text-muted-foreground",
                          )}
                        >
                          {eur(e.ca_encaisse)} encaissés
                        </p>
                      )}
                      {e.obligatoire_meme_a_zero && (
                        <p className="mt-0.5 text-xs text-muted-foreground/80">
                          Obligatoire même à 0 €
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Rubrique>

          {prefill && prefill.informations_manquantes.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-amber-fiscal/40 bg-amber-fiscal/10 p-4">
              <p className="text-[0.9375rem] font-semibold">Informations manquantes à votre profil</p>
              <ul className="space-y-1 text-[0.8125rem] leading-relaxed">
                {prefill.informations_manquantes.map((m) => (
                  <li key={m.champ}>
                    <span className="font-medium">{m.libelle}</span> — {m.consequence}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {chargement && (
            <p className="flex items-center gap-2 text-[0.9375rem] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Préparation des documents…
            </p>
          )}
        </Carte>

        {erreur && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-[0.9375rem] font-medium text-destructive">
            {erreur}
          </div>
        )}

      </div>

      {/* ------------------------------------------------------------------ résultat */}
      <div className="space-y-6 lg:col-span-7">
        {!jeu ? (
          // Tant qu'aucun jeu n'est ouvert, cet espace sert à retrouver les préparations
          // précédentes — c'est ce qu'on vient y chercher le plus souvent.
          <div className="space-y-3">
            <h3 className="rule-label-lg text-accent-ink">Déclarations préparées</h3>
            {archives.length === 0 ? (
              <Carte className="py-8 text-center text-[0.9375rem] text-muted-foreground">
                Aucune préparation pour l'instant.
              </Carte>
            ) : (
              <div className="space-y-2">
                {archives.map((a) => (
                  <div key={a.id} className="rounded-xl border border-border bg-card p-4">
                    <button
                      type="button"
                      onClick={() =>
                        obtenirJeuDeclarations(a.id).then(setJeu).catch(() => {})
                      }
                      className="w-full space-y-1 text-left"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[0.9375rem] font-medium">
                          {dateFr(a.date_debut)} → {dateFr(a.date_fin)}
                        </span>
                        <span className="num tabular-nums text-[0.9375rem] font-semibold">
                          {eur(a.prelevements?.total_a_payer ?? null)}
                        </span>
                      </div>
                      <p className="text-[0.8125rem] text-muted-foreground">
                        préparé le {dateFr(a.genere_le)} · {a.rappels.length} rappel(s)
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        // Aucun jeu n'est ouvert dans cette branche : il n'y a rien à refermer.
                        supprimerJeuDeclarations(a.id)
                          .then(rechargerArchives)
                          .catch(() => {})
                      }
                      className="mt-2 inline-flex items-center gap-1 text-[0.8125rem] text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" /> Supprimer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Un jeu ouvert masque la liste : ce lien y ramène. */}
            <button
              type="button"
              onClick={() => setJeu(null)}
              className="inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-muted-foreground transition-colors hover:text-ink"
            >
              <ArrowLeft className="size-4" /> Toutes les déclarations préparées
            </button>

            <div className="rounded-xl border border-amber-fiscal/40 bg-amber-fiscal/10 p-4 text-[0.8125rem] leading-relaxed">
              {jeu.avertissement}
            </div>

            {/* Synthèse */}
            <Carte className="space-y-4">
              <div>
                <p className="rule-label-lg text-label-ink">Total à régler sur la période</p>
                <p className="num mt-1 text-4xl font-semibold tabular-nums sm:text-5xl">
                  {eur(p?.total_a_payer)}
                </p>
                <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                  sur {eur(jeu.ca_encaisse)} encaissés · {dateFr(jeu.date_debut)} →{" "}
                  {dateFr(jeu.date_fin)}
                </p>
              </div>

              {p && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[24rem] text-[0.9375rem]">
                    <thead>
                      <tr className="rule-label-lg text-label-ink">
                        <th className="py-2 text-left font-normal">Prélèvement</th>
                        <th className="py-2 text-right font-normal">Taux</th>
                        <th className="py-2 text-right font-normal">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.postes.map((poste) => (
                        <>
                          <tr key={`${poste.categorie}-c`} className="border-t border-border/60">
                            <td className="py-2">Cotisations sociales — {poste.categorie}</td>
                            <td className="num py-2 text-right tabular-nums">
                              {pourcent(poste.taux_cotisations)}
                            </td>
                            <td className="num py-2 text-right tabular-nums">
                              {eur(poste.cotisations_sociales)}
                            </td>
                          </tr>
                          <tr key={`${poste.categorie}-f`} className="border-t border-border/60">
                            <td className="py-2">
                              CFP
                              {poste.cfp_exoneree && (
                                <span className="ml-1 text-[0.8125rem] text-muted-foreground">
                                  (exonérée)
                                </span>
                              )}
                            </td>
                            <td className="num py-2 text-right tabular-nums">
                              {pourcent(poste.taux_cfp)}
                            </td>
                            <td className="num py-2 text-right tabular-nums">{eur(poste.cfp)}</td>
                          </tr>
                          {poste.tfcc_applicable && (
                            <tr key={`${poste.categorie}-t`} className="border-t border-border/60">
                              <td className="py-2">TFCC (chambre consulaire)</td>
                              <td className="num py-2 text-right tabular-nums">
                                {pourcent(poste.taux_tfcc)}
                              </td>
                              <td className="num py-2 text-right tabular-nums">{eur(poste.tfcc)}</td>
                            </tr>
                          )}
                          {poste.versement_liberatoire !== undefined && (
                            <tr key={`${poste.categorie}-v`} className="border-t border-border/60">
                              <td className="py-2">Versement libératoire de l'IR</td>
                              <td className="num py-2 text-right tabular-nums">
                                {pourcent(poste.taux_versement_liberatoire)}
                              </td>
                              <td className="num py-2 text-right tabular-nums">
                                {eur(poste.versement_liberatoire)}
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Carte>

            {/* Écart avec un rapport déjà établi : à voir AVANT de déclarer */}
            {jeu.recoupement_rapport && !jeu.recoupement_rapport.concordant && (
              <Carte className="space-y-2 border-destructive/30 bg-destructive/5">
                <Rubrique titre="Écart avec un rapport fiscal antérieur">
                  <div className="space-y-1">
                    <LigneChiffre
                      libelle="Chiffre d'affaires du rapport"
                      valeur={eur(jeu.recoupement_rapport.ca_du_rapport)}
                    />
                    <LigneChiffre
                      libelle="Chiffre d'affaires déclaré ici"
                      valeur={eur(jeu.recoupement_rapport.ca_declare)}
                    />
                    <LigneChiffre
                      libelle="Écart"
                      valeur={eur(jeu.recoupement_rapport.ecart)}
                      fort
                    />
                  </div>
                  <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                    Une pièce a été ajoutée, corrigée ou supprimée entre les deux. Identifiez
                    laquelle avant de déclarer : sinon le montant transmis sera injustifiable.
                  </p>
                </Rubrique>
              </Carte>
            )}

            {/* TVA chiffrée depuis les pièces */}
            {jeu.brouillons.some((b) => b.type === "tva_ca3" && b.applicable) && (
              <Carte className="space-y-3">
                <Rubrique titre="TVA de la période">
                  <div className="space-y-1">
                    <LigneChiffre
                      libelle="TVA collectée"
                      aide={`${jeu.tva_collectee.lignes.length} facture(s) émise(s)`}
                      valeur={eur(jeu.tva_collectee.total)}
                    />
                    <LigneChiffre
                      libelle="TVA déductible"
                      aide={`${jeu.tva_deductible.lignes.length} facture(s) d'achat`}
                      valeur={eur(jeu.tva_deductible.total)}
                    />
                    <LigneChiffre
                      libelle="TVA nette due"
                      valeur={eur(jeu.tva_collectee.total - jeu.tva_deductible.total)}
                      fort
                    />
                  </div>
                  <p className="text-[0.8125rem] leading-relaxed text-amber-fiscal">
                    {jeu.tva_deductible.reserve}
                  </p>
                  {jeu.tva_deductible.pieces_sans_tva_lue > 0 && (
                    <p className="text-[0.8125rem] leading-relaxed text-amber-fiscal">
                      {jeu.tva_deductible.pieces_sans_tva_lue} facture(s) d'achat sans TVA
                      lisible : elles ne sont pas comptées. Une TVA illisible n'est pas une
                      TVA nulle.
                    </p>
                  )}
                </Rubrique>
              </Carte>
            )}

            {/* Avantages en nature : dans les cases, hors de tout relevé bancaire */}
            {(jeu.cadeaux_recus.length > 0 || jeu.cadeaux_a_valoriser.length > 0) && (
              <Carte className="space-y-3">
                <Rubrique titre="Avantages en nature">
                  {jeu.cadeaux_recus.length > 0 && (
                    <>
                      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                        Fiscalement, ce ne sont pas des cadeaux : un partenariat rémunéré en
                        produits est un revenu en nature. Ces montants sont{" "}
                        <strong>compris dans les cases déclarées</strong>, alors qu'ils
                        n'apparaissent sur aucun relevé bancaire.
                      </p>
                      <div className="space-y-1">
                        {jeu.cadeaux_recus.map((c) => (
                          <div
                            key={c.document_id}
                            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border/60 py-2 text-[0.9375rem] last:border-0"
                          >
                            <span className="text-[0.8125rem] text-muted-foreground">{dateFr(c.date)}</span>
                            <span className="min-w-0 flex-1 truncate">
                              {c.description ?? "—"}
                              {c.marque && (
                                <span className="ml-1 text-[0.8125rem] text-muted-foreground">
                                  · {c.marque}
                                </span>
                              )}
                            </span>
                            <span className="num tabular-nums font-medium">
                              {eur(c.valeur_eur)}
                            </span>
                          </div>
                        ))}
                        <LigneChiffre
                          libelle="Total inclus dans le chiffre d'affaires"
                          valeur={eur(jeu.total_cadeaux_eur)}
                          fort
                        />
                      </div>
                    </>
                  )}

                  {jeu.cadeaux_a_valoriser.length > 0 && (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                      <p className="text-[0.9375rem] font-semibold text-destructive">
                        {jeu.cadeaux_a_valoriser.length} cadeau(x) sans valeur retenue
                      </p>
                      <p className="mt-1 text-[0.8125rem] leading-relaxed">
                        Ils ne sont <strong>pas comptés</strong> : votre chiffre d'affaires
                        déclaré s'en trouve minoré. Valorisez-les dans vos justificatifs avant
                        de transmettre.
                      </p>
                      <ul className="mt-2 space-y-0.5 text-[0.8125rem] text-muted-foreground">
                        {jeu.cadeaux_a_valoriser.map((c) => (
                          <li key={c.document_id}>
                            {dateFr(c.date)} — {c.description ?? "objet non décrit"}
                            {c.marque && ` · ${c.marque}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Rubrique>
              </Carte>
            )}

            {/* Rappels */}
            {jeu.rappels.length > 0 && (
              <Carte className="space-y-3">
                <Rubrique titre="À faire">
                  <div className="space-y-2">
                    {jeu.rappels.map((r, i) => (
                      <BlocRappel key={`${r.declaration}-${i}`} rappel={r} />
                    ))}
                  </div>
                </Rubrique>
              </Carte>
            )}

            {/* Revenus européens */}
            {jeu.revenus_ue.length > 0 && (
              <Carte className="space-y-3">
                <Rubrique titre="Encaissements d'origine européenne">
                  <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                    Ils déclenchent une DES <strong>même sous franchise de TVA</strong> : les deux
                    régimes sont indépendants.
                  </p>
                  <div className="space-y-1">
                    {jeu.revenus_ue.map((r) => (
                      <div
                        key={r.virement_document_id}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border/60 py-2 text-[0.9375rem] last:border-0"
                      >
                        <span className="text-[0.8125rem] text-muted-foreground">{dateFr(r.date)}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {r.contrepartie ?? "—"}
                          {r.pays && (
                            <span className="ml-1 text-[0.8125rem] text-muted-foreground">({r.pays})</span>
                          )}
                        </span>
                        {!r.certain && (
                          <span className="inline-flex items-center gap-1 text-[0.8125rem] text-amber-fiscal">
                            <AlertTriangle className="size-3.5" /> à confirmer
                          </span>
                        )}
                        <span className="num tabular-nums font-medium">{eur(r.montant_eur)}</span>
                      </div>
                    ))}
                  </div>
                </Rubrique>
              </Carte>
            )}

            {/* Documents signables */}
            <Carte className="space-y-3">
              <Rubrique titre="Documents prêts pour signature">
                <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                  Chaque document identifie l'entreprise, énonce la période, reprend les cases
                  officielles et se termine par un bloc de signature — attestation du déclarant,
                  puis visa de l'expert-comptable.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void exporter(
                      () => telechargerDossier(jeu.id, jeu.date_debut, jeu.date_fin),
                      "dossier",
                    )
                  }
                  disabled={export_ !== null}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 text-[0.9375rem] font-medium text-accent-ink shadow-soft transition-all hover:brightness-[1.04] active:scale-[0.98] disabled:opacity-40"
                >
                  {export_ === "dossier" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <FileText className="size-4" />
                  )}
                  Dossier complet à faire signer
                </button>
                <div className="flex flex-wrap gap-2">
                  {jeu.brouillons.filter((b) => b.applicable).map((b) => (
                    <button
                      key={b.type}
                      type="button"
                      onClick={() =>
                        void exporter(
                          () =>
                            telechargerDocument(jeu.id, b.type, jeu.date_debut, jeu.date_fin),
                          b.type,
                        )
                      }
                      disabled={export_ !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors hover:border-ink disabled:opacity-40"
                    >
                      {export_ === b.type ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                      {b.formulaire ?? b.titre.split(" ")[0]}
                    </button>
                  ))}
                </div>
              </Rubrique>
            </Carte>

            {/* Détail de chaque déclaration */}
            <div className="space-y-3">
              <h3 className="rule-label-lg text-accent-ink">Détail des déclarations</h3>
              {jeu.brouillons.map((b) => (
                <CarteBrouillon key={b.type} brouillon={b} />
              ))}
            </div>

            {/* Hypothèses */}
            <Carte>
              <Rubrique titre="Hypothèses retenues">
                <ul className="space-y-1.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
                  {jeu.hypotheses.map((h, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted-foreground/50">—</span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </Rubrique>
            </Carte>
          </>
        )}
      </div>
    </div>
  );
}
