/**
 * Écran de facturation — cycle de vie complet d'une facture.
 *
 * Le jalon structurant est l'ÉMISSION : un brouillon se modifie et se supprime librement,
 * une facture émise ne se corrige plus que par avoir. C'est une obligation légale, pas une
 * préférence d'interface — d'où la séparation nette des deux gestes et des deux listes.
 *
 * Aucun calcul de montant n'est fait ici : le total affiché avant émission est un aperçu,
 * la valeur qui fait foi est celle renvoyée par le serveur.
 */

import {
  AlertTriangle,
  Check,
  FileText,
  Loader2,
  Lock,
  Plus,
  Trash2,
  Undo2,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  alerteTva,
  contexteFacturation,
  creerAvoir,
  creerBrouillon,
  emettreFacture,
  enregistrerReglement,
  listerFactures,
  modifierBrouillon,
  supprimerBrouillon,
  supprimerFacture,
  telechargerFacturePdf,
  type AlerteTva,
  type ContexteFacturation,
  type Facture,
  type FacturePayload,
  type LigneFacture,
  type StatutFacture,
} from "@/lib/facturation-api";

const ligneVide = (): LigneFacture => ({
  designation: "",
  quantite: 1,
  prix_unitaire_ht: 0,
  taux_tva: 0,
  categorie: "prestation",
  remise_pourcent: 0,
});

const STATUT_LIBELLE: Record<StatutFacture, string> = {
  brouillon: "Brouillon",
  emise: "Émise",
  partiellement_payee: "Partiellement payée",
  payee: "Payée",
  annulee: "Annulée par avoir",
};

function BadgeStatut({ statut }: { statut: StatutFacture }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        statut === "payee" && "border-success/30 bg-success/12 text-success-ink",
        statut === "emise" && "border-info/30 bg-info/12 text-info-ink",
        statut === "partiellement_payee" && "border-warning/40 bg-warning/15 text-warning-ink",
        statut === "brouillon" && "border-border bg-secondary text-muted-foreground",
        statut === "annulee" && "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {STATUT_LIBELLE[statut]}
    </span>
  );
}

const champStyle =
  "w-full rounded-lg border border-transparent bg-background px-3 py-2 text-sm input-boxed";

const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

/** Total HT d'une ligne, remise déduite. Aperçu : la valeur qui fait foi vient du serveur. */
function totalLigneHt(l: LigneFacture): number {
  return l.quantite * l.prix_unitaire_ht * (1 - (l.remise_pourcent ?? 0) / 100);
}

/** Libellé au-dessus d'un champ. Un placeholder disparaît dès la saisie ; pas un label. */
function Champ({
  label,
  aide,
  children,
  className,
}: {
  label: string;
  aide?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="rule-label text-muted-foreground">{label}</label>
      <div className="mt-1.5">{children}</div>
      {aide && <p className="mt-1 text-xs text-muted-foreground">{aide}</p>}
    </div>
  );
}

/**
 * Totaux du document. Aucun n'est saisi : ils découlent des lignes et du régime de TVA.
 *
 * La TVA en particulier n'est PAS un champ à remplir. Sous franchise en base elle est nulle
 * par construction (art. 293 B du CGI) et la mention la remplace sur la facture ; sinon elle
 * suit le taux porté par chaque ligne. Laisser l'utilisateur la saisir librement produirait
 * des factures avec de la TVA sous franchise — ou l'inverse.
 */
function Totaux({
  ht,
  tva,
  ttc,
  acompte,
  sousFranchise,
  regimeIndetermine,
  mentionTva,
}: {
  ht: number;
  tva: number;
  ttc: number;
  acompte: number;
  sousFranchise: boolean;
  regimeIndetermine: boolean;
  mentionTva: string | null;
}) {
  return (
    <div className="ml-auto w-full max-w-sm space-y-1 rounded-xl bg-background p-4">
      <Total libelle="Total HT" valeur={eur(ht)} />

      {regimeIndetermine ? (
        <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
          <span className="text-muted-foreground">TVA</span>
          <span className="text-right text-xs font-medium text-warning-ink">
            régime non qualifié
          </span>
        </div>
      ) : sousFranchise ? (
        <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
          <span className="text-muted-foreground">TVA</span>
          <span className="num text-right tabular-nums">{eur(0)}</span>
        </div>
      ) : (
        <Total libelle="TVA" valeur={eur(tva)} />
      )}

      <div className="border-t border-border pt-1.5">
        <Total libelle="Total TTC" valeur={eur(ttc)} fort />
      </div>

      {acompte > 0 && (
        <>
          <Total libelle="Acompte déjà versé" valeur={`− ${eur(acompte)}`} />
          <div className="border-t border-border pt-1.5">
            <Total libelle="Net à payer" valeur={eur(Math.max(ttc - acompte, 0))} fort />
          </div>
        </>
      )}

      {sousFranchise && mentionTva && (
        <p className="pt-2 text-xs leading-relaxed text-muted-foreground">{mentionTva}</p>
      )}
      {regimeIndetermine && (
        <p className="pt-2 text-xs leading-relaxed text-warning-ink">
          Votre régime de TVA n'est pas renseigné : la facture ne peut porter ni la mention
          d'exonération, ni un taux. Complétez-le dans votre parcours fiscal.
        </p>
      )}
      <p className="pt-1 text-xs text-muted-foreground/80">
        Montants indicatifs : les valeurs qui font foi sont calculées à l'émission.
      </p>
    </div>
  );
}

function Total({
  libelle,
  valeur,
  fort,
}: {
  libelle: string;
  valeur: string;
  fort?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className={cn("text-sm", fort ? "font-medium" : "text-muted-foreground")}>
        {libelle}
      </span>
      <span className={cn("num tabular-nums", fort ? "text-base font-semibold" : "text-sm")}>
        {valeur}
      </span>
    </div>
  );
}

export function FactureCycleVie() {
  // -- Saisie ---------------------------------------------------------------
  const [clientNom, setClientNom] = useState("");
  const [clientPro, setClientPro] = useState(false);
  const [clientAdresse, setClientAdresse] = useState("");
  const [clientSiret, setClientSiret] = useState("");
  const [clientTva, setClientTva] = useState("");
  const [lignes, setLignes] = useState<LigneFacture[]>([ligneVide()]);
  const [numeroContrat, setNumeroContrat] = useState("");
  const [bonCommande, setBonCommande] = useState("");
  const [delaiJours, setDelaiJours] = useState<number | "">("");
  const [modePaiement, setModePaiement] = useState("");
  // L'acompte est l'exception, pas la règle : ses champs n'apparaissent qu'une fois coché.
  const [acompteVerse, setAcompteVerse] = useState(false);
  const [acompteMontant, setAcompteMontant] = useState<number | "">("");
  const [optionsOuvertes, setOptionsOuvertes] = useState(false);

  // -- État --------------------------------------------------------------
  const [brouillonId, setBrouillonId] = useState<string | null>(null);
  const [manquants, setManquants] = useState<string[]>([]);
  const [documents, setDocuments] = useState<Facture[]>([]);
  const [alerte, setAlerte] = useState<AlerteTva | null>(null);
  const [contexte, setContexte] = useState<ContexteFacturation | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function recharger() {
    const [liste, tva, ctx] = await Promise.all([
      listerFactures().catch(() => ({ factures: [] as Facture[] })),
      alerteTva().catch(() => null),
      contexteFacturation().catch(() => null),
    ]);
    setDocuments(liste.factures);
    setAlerte(tva);
    setContexte(ctx);
  }

  useEffect(() => {
    void recharger();
  }, []);

  function majLigne(i: number, patch: Partial<LigneFacture>) {
    setLignes((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function payload(): FacturePayload {
    return {
      client: {
        nom: clientNom.trim(),
        est_professionnel: clientPro,
        adresse: clientAdresse.trim() || null,
        siret: clientSiret.trim() || null,
        numero_tva_intracom: clientTva.trim() || null,
      },
      lignes,
      numero_contrat: numeroContrat.trim() || null,
      numero_bon_commande: bonCommande.trim() || null,
      delai_paiement_jours: delaiJours === "" ? null : Number(delaiJours),
      mode_paiement: modePaiement.trim() || null,
      // Case décochée : aucun acompte transmis, même si un montant traîne dans le champ.
      acompte:
        !acompteVerse || acompteMontant === "" || Number(acompteMontant) <= 0
          ? null
          : { montant_ttc: Number(acompteMontant) },
    };
  }

  function reinitialiser() {
    setClientNom("");
    setClientPro(false);
    setClientAdresse("");
    setClientSiret("");
    setClientTva("");
    setLignes([ligneVide()]);
    setNumeroContrat("");
    setBonCommande("");
    setDelaiJours("");
    setModePaiement("");
    setAcompteVerse(false);
    setAcompteMontant("");
    setBrouillonId(null);
    setManquants([]);
  }

  async function agir(cle: string, action: () => Promise<void>) {
    setOccupe(cle);
    setErreur(null);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Opération impossible.");
    } finally {
      setOccupe(null);
    }
  }

  const saisieValide = clientNom.trim() !== "" && lignes.every((l) => l.designation.trim() !== "");

  // Aperçu local — la valeur qui fait foi reste celle calculée par le serveur. La TVA n'est
  // pas saisie : sous franchise en base elle est nulle par construction (art. 293 B), sinon
  // elle suit le taux porté par chaque ligne.
  const sousFranchise = contexte?.franchise_tva === true;
  const regimeIndetermine = contexte != null && contexte.franchise_tva === null;

  const apercuHt = lignes.reduce((t, l) => t + totalLigneHt(l), 0);
  const apercuTva = sousFranchise
    ? 0
    : lignes.reduce((t, l) => t + totalLigneHt(l) * (l.taux_tva ?? 0), 0);
  const apercuTtc = apercuHt + apercuTva;
  const acompteApplique = acompteVerse && acompteMontant !== "" ? Number(acompteMontant) : 0;

  async function enregistrerBrouillon() {
    await agir("brouillon", async () => {
      const res = brouillonId
        ? await modifierBrouillon(brouillonId, payload())
        : await creerBrouillon(payload());
      setBrouillonId(res.facture.id);
      setManquants(res.champs_manquants);
      setMessage("Brouillon enregistré — aucun numéro consommé.");
      await recharger();
    });
  }

  async function emettre() {
    await agir("emettre", async () => {
      // L'émission porte sur un brouillon : on le crée à la volée si besoin, pour que le
      // contenu affiché à l'écran soit exactement celui qui sera figé.
      let id = brouillonId;
      const res = id ? await modifierBrouillon(id, payload()) : await creerBrouillon(payload());
      id = res.facture.id;
      setManquants(res.champs_manquants);
      const emise = await emettreFacture(id);
      setMessage(`Facture ${emise.numero} émise — elle est désormais figée.`);
      reinitialiser();
      await recharger();
    });
  }

  const brouillons = documents.filter((d) => d.statut === "brouillon");
  const emis = documents.filter((d) => d.statut !== "brouillon");

  return (
    <div className="grid items-start gap-10 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-7">
        {/* Alerte de seuil : informative, jamais décisionnelle — le régime reste déclaré. */}
        {alerte?.alerte && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-4 text-sm text-warning-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">{alerte.alerte.message}</p>
              <p className="text-xs opacity-90">{alerte.alerte.note}</p>
            </div>
          </div>
        )}

        {/* Informations collectées à l'onboarding qui manquent encore à la facture. Les
            signaler ici évite que l'utilisateur ne le découvre sur le PDF final. */}
        {contexte && contexte.champs_profil_manquants.length > 0 && (
          <div className="space-y-2 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-4 text-sm text-warning-ink">
            <p className="font-medium">Votre profil est incomplet pour facturer</p>
            <ul className="space-y-1 text-xs">
              {contexte.champs_profil_manquants.map((c) => (
                <li key={c.champ}>
                  <span className="font-medium">{c.libelle}</span> — {c.consequence}
                </li>
              ))}
            </ul>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void emettre();
          }}
          className="space-y-5 rounded-2xl border border-border bg-card p-8"
        >
          {/* Le régime détermine la TVA du document : il est affiché, jamais saisi ici. */}
          {contexte && (
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-4 text-sm">
              <span className="font-medium">{contexte.denomination ?? "Votre activité"}</span>
              <span className="text-xs text-muted-foreground">
                SIREN {contexte.siren ?? "—"} ·{" "}
                {contexte.franchise_tva === true
                  ? "franchise en base de TVA"
                  : contexte.franchise_tva === false
                    ? "assujetti à la TVA"
                    : "régime de TVA non qualifié"}
              </span>
            </div>
          )}
          <div className="space-y-4">
            <h3 className="rule-label text-accent-ink">Client</h3>
            <Champ label="Nom ou raison sociale du client">
              <input
                type="text"
                value={clientNom}
                onChange={(e) => setClientNom(e.target.value)}
                placeholder="Ex. Atelier Dupont & Fils"
                className="w-full border-b border-border bg-transparent px-0 py-2.5 text-lg transition-colors focus:border-ink focus:outline-none"
              />
            </Champ>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-border accent-primary"
                checked={clientPro}
                onChange={(e) => setClientPro(e.target.checked)}
              />
              Le client est un professionnel (entreprise, association)
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <Champ
                label="Adresse de facturation"
                aide="Mention obligatoire sur toute facture."
                className="sm:col-span-2"
              >
                <input
                  className={champStyle}
                  placeholder="14 rue des Lilas, 69003 Lyon"
                  value={clientAdresse}
                  onChange={(e) => setClientAdresse(e.target.value)}
                />
              </Champ>
              {clientPro && (
                <Champ label="SIRET du client" aide="Obligatoire entre professionnels.">
                  <input
                    className={champStyle}
                    placeholder="14 chiffres"
                    value={clientSiret}
                    onChange={(e) => setClientSiret(e.target.value)}
                  />
                </Champ>
              )}
              {clientPro && (
                <Champ
                  label="N° de TVA intracommunautaire du client"
                  aide="Requis pour l'autoliquidation intra-UE."
                >
                  <input
                    className={champStyle}
                    placeholder="Ex. FR40812345678"
                    value={clientTva}
                    onChange={(e) => setClientTva(e.target.value)}
                  />
                </Champ>
              )}
            </div>
          </div>

          <div className="space-y-3 border-t border-border pt-5">
            <h3 className="rule-label text-accent-ink">Prestations / produits</h3>

            <div className="overflow-x-auto">
              <div className="min-w-[46rem] space-y-2">
                {/* En-têtes : sans eux, six champs numériques côte à côte sont illisibles. */}
                <div className="grid grid-cols-24 gap-2 px-1">
                  <span className="rule-label col-span-4 text-muted-foreground">Catégorie</span>
                  <span className="rule-label col-span-7 text-muted-foreground">Désignation</span>
                  <span className="rule-label col-span-3 text-right text-muted-foreground">
                    Quantité
                  </span>
                  <span className="rule-label col-span-4 text-right text-muted-foreground">
                    Prix unitaire HT
                  </span>
                  <span className="rule-label col-span-2 text-right text-muted-foreground">
                    Remise
                  </span>
                  <span className="rule-label col-span-3 text-right text-muted-foreground">
                    Total HT
                  </span>
                  <span className="col-span-1" />
                </div>

                {lignes.map((l, i) => (
                  <div key={i} className="grid grid-cols-24 items-center gap-2">
                    <select
                      className={cn(champStyle, "col-span-4")}
                      value={l.categorie}
                      onChange={(e) =>
                        majLigne(i, { categorie: e.target.value as LigneFacture["categorie"] })
                      }
                    >
                      <option value="prestation">Prestation</option>
                      <option value="vente">Vente</option>
                    </select>
                    <input
                      className={cn(champStyle, "col-span-7")}
                      placeholder="Ex. Reel Instagram"
                      value={l.designation}
                      onChange={(e) => majLigne(i, { designation: e.target.value })}
                    />
                    <input
                      className={cn(champStyle, "col-span-3 text-right tabular-nums")}
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.quantite}
                      onChange={(e) => majLigne(i, { quantite: Number(e.target.value) })}
                    />
                    <input
                      className={cn(champStyle, "col-span-4 text-right tabular-nums")}
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.prix_unitaire_ht}
                      onChange={(e) => majLigne(i, { prix_unitaire_ht: Number(e.target.value) })}
                    />
                    <input
                      className={cn(champStyle, "col-span-2 text-right tabular-nums")}
                      type="number"
                      min={0}
                      max={100}
                      step="1"
                      title="Remise en %"
                      value={l.remise_pourcent ?? 0}
                      onChange={(e) => majLigne(i, { remise_pourcent: Number(e.target.value) })}
                    />
                    {/* Calculé, jamais saisi : deux sources pour un même total divergeraient. */}
                    <span className="num col-span-3 pr-1 text-right text-sm tabular-nums">
                      {eur(totalLigneHt(l))}
                    </span>
                    <button
                      type="button"
                      onClick={() => setLignes((p) => p.filter((_, idx) => idx !== i))}
                      disabled={lignes.length === 1}
                      title="Retirer cette ligne"
                      className="col-span-1 grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive disabled:opacity-30"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setLignes((prev) => [...prev, ligneVide()])}
              className="inline-flex items-center gap-1 text-sm font-medium text-teal-dark hover:underline"
            >
              <Plus className="size-3.5" /> Ajouter une ligne
            </button>

            <Totaux
              ht={apercuHt}
              tva={apercuTva}
              ttc={apercuTtc}
              acompte={acompteApplique}
              sousFranchise={sousFranchise}
              regimeIndetermine={regimeIndetermine}
              mentionTva={contexte?.mention_tva ?? null}
            />
          </div>

          {/* Options : conditions de règlement, traçabilité, acompte. */}
          <div className="border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setOptionsOuvertes((v) => !v)}
              className="rule-label text-accent-ink hover:underline"
            >
              {optionsOuvertes ? "− " : "+ "}Règlement, contrat et acompte
            </button>
            {optionsOuvertes && (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Champ
                    label="Délai de paiement (jours)"
                    aide={
                      contexte
                        ? `À défaut, ${contexte.delai_paiement_defaut} jours s'appliquent.`
                        : undefined
                    }
                  >
                    <input
                      className={champStyle}
                      type="number"
                      min={0}
                      placeholder="30"
                      value={delaiJours}
                      onChange={(e) =>
                        setDelaiJours(e.target.value === "" ? "" : Number(e.target.value))
                      }
                    />
                  </Champ>
                  <Champ label="Mode de règlement">
                    <input
                      className={champStyle}
                      placeholder="Virement bancaire"
                      value={modePaiement}
                      onChange={(e) => setModePaiement(e.target.value)}
                    />
                  </Champ>
                  <Champ label="N° de contrat" aide="Facultatif — traçabilité vers le contrat.">
                    <input
                      className={champStyle}
                      placeholder="Ex. CTR-2026-014"
                      value={numeroContrat}
                      onChange={(e) => setNumeroContrat(e.target.value)}
                    />
                  </Champ>
                  <Champ label="N° de bon de commande" aide="Facultatif.">
                    <input
                      className={champStyle}
                      placeholder="Ex. BC-8842"
                      value={bonCommande}
                      onChange={(e) => setBonCommande(e.target.value)}
                    />
                  </Champ>
                </div>

                <div className="rounded-xl border border-border p-4">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-border accent-primary"
                      checked={acompteVerse}
                      onChange={(e) => setAcompteVerse(e.target.checked)}
                    />
                    Un acompte a déjà été versé
                  </label>
                  {acompteVerse && (
                    <Champ
                      label="Acompte déjà versé (TTC)"
                      aide="Déduit du total : la facture n'appellera que le solde."
                      className="mt-3 sm:max-w-xs"
                    >
                      <input
                        className={champStyle}
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="0,00"
                        value={acompteMontant}
                        onChange={(e) =>
                          setAcompteMontant(e.target.value === "" ? "" : Number(e.target.value))
                        }
                      />
                    </Champ>
                  )}
                </div>
              </div>
            )}
          </div>

          {manquants.length > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-ink">
              <p className="font-medium">Mentions obligatoires manquantes</p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {manquants.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void enregistrerBrouillon()}
                disabled={!saisieValide || occupe !== null}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border px-4 text-sm font-medium transition-all hover:border-ink active:scale-[0.98] disabled:opacity-40"
              >
                {occupe === "brouillon" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileText className="size-4" />
                )}
                {brouillonId ? "Mettre à jour le brouillon" : "Enregistrer en brouillon"}
              </button>
              <button
                type="submit"
                disabled={!saisieValide || occupe !== null}
                title="Attribue le numéro légal et fige le document"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-6 text-sm font-medium text-accent-ink shadow-soft transition-all hover:brightness-[1.04] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {occupe === "emettre" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Lock className="size-4" />
                )}
                Émettre la facture
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Un brouillon ne consomme aucun numéro et reste modifiable. L'émission attribue le
            numéro légal et fige définitivement le document : sa correction passera par un avoir.
          </p>
        </form>

        {erreur && (
          <div
            role="alert"
            className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm font-medium text-destructive"
          >
            {erreur}
          </div>
        )}
        {message && !erreur && (
          <div className="flex items-center gap-2 rounded-2xl border border-success/30 bg-success/10 px-5 py-4 text-sm text-success-ink">
            <Check className="size-4 shrink-0" />
            {message}
          </div>
        )}

      </div>

      <div className="space-y-6 lg:sticky lg:top-24 lg:col-span-5">
        {brouillons.length > 0 && (
          <section className="space-y-3">
            <h3 className="rule-label text-muted-foreground">
              Brouillons · sans existence fiscale
            </h3>
            {brouillons.map((f) => (
              <div key={f.id} className="rounded-2xl border border-dashed border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{f.client.nom || "Sans client"}</p>
                    <p className="num text-xs text-muted-foreground">
                      {f.net_a_payer.toFixed(2)} € TTC
                    </p>
                  </div>
                  <BadgeStatut statut={f.statut} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void agir(`emettre-${f.id}`, async () => {
                        const e = await emettreFacture(f.id);
                        setMessage(`Facture ${e.numero} émise.`);
                        if (brouillonId === f.id) reinitialiser();
                        await recharger();
                      })
                    }
                    disabled={occupe !== null}
                    className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-40"
                  >
                    <Lock className="size-3" /> Émettre
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Un brouillon n'a aucune existence fiscale : sa suppression ne casse
                      // rien. On confirme quand même, la saisie en cours étant perdue.
                      if (
                        !window.confirm(
                          `Supprimer le brouillon « ${f.client.nom || "sans client"} » ?\n\n` +
                            "Aucun numéro n'a été consommé : la séquence reste intacte.",
                        )
                      )
                        return;
                      void agir(`suppr-${f.id}`, async () => {
                        await supprimerBrouillon(f.id);
                        if (brouillonId === f.id) reinitialiser();
                        setMessage("Brouillon supprimé.");
                        await recharger();
                      });
                    }}
                    disabled={occupe !== null}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="size-3" /> Supprimer
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="space-y-3">
          <h3 className="rule-label text-accent-ink">Documents émis</h3>
          {emis.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              Aucune facture émise pour l&apos;instant.
            </div>
          ) : (
            emis.map((f) => (
              <div key={f.id} className="card-hover rounded-2xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="num text-sm font-medium">{f.numero}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {f.client.nom} · {f.net_a_payer.toFixed(2)} € TTC
                      {f.montant_regle > 0 && ` · ${f.montant_regle.toFixed(2)} € réglés`}
                    </p>
                    {f.facture_origine_numero && (
                      <p className="text-xs text-muted-foreground">
                        annule {f.facture_origine_numero}
                      </p>
                    )}
                    {f.avoir_numero && (
                      <p className="text-xs text-muted-foreground">
                        annulée par {f.avoir_numero}
                      </p>
                    )}
                  </div>
                  <BadgeStatut statut={f.statut} />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void telechargerFacturePdf(f.id, f.numero)}
                    className="text-xs font-medium text-teal-dark hover:underline"
                  >
                    PDF
                  </button>

                  {f.statut !== "payee" && f.statut !== "annulee" && f.type_document === "facture" && (
                    <button
                      type="button"
                      onClick={() => {
                        const reste = (f.net_a_payer - f.montant_regle).toFixed(2);
                        const saisie = window.prompt("Montant encaissé (€)", reste);
                        if (!saisie) return;
                        const montant = Number(saisie.replace(",", "."));
                        if (!Number.isFinite(montant) || montant <= 0) return;
                        void agir(`regl-${f.id}`, async () => {
                          await enregistrerReglement(f.id, montant);
                          setMessage("Règlement enregistré.");
                          await recharger();
                        });
                      }}
                      disabled={occupe !== null}
                      className="inline-flex items-center gap-1 text-xs font-medium text-teal-dark hover:underline disabled:opacity-40"
                    >
                      <Wallet className="size-3" /> Règlement
                    </button>
                  )}

                  {f.statut !== "annulee" && f.type_document === "facture" && !f.avoir_numero && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Émettre un avoir annulant ${f.numero} ?\n\n` +
                              "La facture restera archivée — elle n'est jamais supprimée.",
                          )
                        )
                          return;
                        void agir(`avoir-${f.id}`, async () => {
                          const res = await creerAvoir(f.id, {
                            client: f.client,
                            lignes: f.lignes,
                            numero_contrat: f.numero_contrat ?? null,
                          });
                          setMessage(`Avoir ${res.avoir.numero} émis.`);
                          await recharger();
                        });
                      }}
                      disabled={occupe !== null}
                      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-destructive hover:underline disabled:opacity-40"
                    >
                      <Undo2 className="size-3" /> Avoir
                    </button>
                  )}

                  {/* Suppression définitive. Distincte de l'avoir : celui-ci annule les effets
                      du document en le laissant archivé, celle-là retire le numéro de la
                      séquence — ce que la réglementation interdit. D'où la double confirmation
                      et le rappel de la voie conforme. */}
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Supprimer définitivement ${f.numero} ?\n\n` +
                            "Ce document est émis. Le supprimer laisse un TROU dans votre " +
                            "numérotation, ce que la réglementation interdit, et le rapport " +
                            "fiscal perdra la facture à laquelle un encaissement se rattache.\n\n" +
                            "La correction conforme est l'avoir, qui annule la facture sans la " +
                            "faire disparaître.\n\n" +
                            "Le numéro retiré sera consigné pour rester justifiable.",
                        )
                      )
                        return;
                      void agir(`suppr-${f.id}`, async () => {
                        const res = await supprimerFacture(f.id, true);
                        setMessage(
                          `${res.numero ?? "Document"} supprimé — numéro consigné dans la trace ` +
                            "des suppressions.",
                        );
                        await recharger();
                      });
                    }}
                    disabled={occupe !== null}
                    className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive hover:underline disabled:opacity-40"
                  >
                    <Trash2 className="size-3" /> Supprimer
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
