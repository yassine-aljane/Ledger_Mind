/**
 * Déclaration d'un cadeau / avantage en nature reçu d'une marque (« gifting »).
 *
 * La photo passe au modèle de vision, qui extrait objet, marque et valeur.
 * L'utilisateur RELIT et confirme — il ne remplit pas à la main sauf correction.
 */

import { useState } from "react";
import { CheckCircle2, Gift, Info, Loader2, Pencil, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GiftCadeauDrop } from "@/components/lm/GiftCadeauDrop";
import { cn } from "@/lib/utils";
import {
  declarerCadeau,
  estimerCadeau,
  formatMoney,
  type CaptureEstimationCadeau,
} from "@/lib/api";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const CONFIANCE_LABEL: Record<string, string> = {
  haute: "confiance haute",
  moyenne: "confiance moyenne",
  faible: "confiance faible",
};

/** Pastille de confiance : la couleur porte le niveau, le texte le nomme. */
const TON_CONFIANCE: Record<string, string> = {
  haute: "bg-success",
  moyenne: "bg-warning",
  faible: "bg-destructive",
};

function valeurPreRemplie(est: CaptureEstimationCadeau): string {
  if (est.valeur_estimee != null) return String(Math.round(est.valeur_estimee));
  if (est.fourchette_min != null && est.fourchette_max != null) {
    return String(Math.round((est.fourchette_min + est.fourchette_max) / 2));
  }
  if (est.fourchette_min != null) return String(Math.round(est.fourchette_min));
  return "";
}

const ETAPES_CADEAU = ["Lecture", "Reconnaissance", "Estimation", "Contrôle"];

type PhasePhoto = "idle" | "analyse" | "termine" | "erreur";

const PHASE_LIBELLE: Record<Exclude<PhasePhoto, "idle">, string> = {
  analyse: "Analyse en cours",
  termine: "Terminé",
  erreur: "Échec",
};

function AnalysePhoto({ nom, phase }: { nom: string; phase: PhasePhoto }) {
  if (phase === "idle") return null;
  const fini = phase !== "analyse";

  return (
    <section className="animate-rise space-y-3 rounded-2xl border border-border bg-card p-5 shadow-soft">
      <h3 className="rule-label text-muted-foreground">Analyse du cadeau · {fini ? 1 : 0}/1</h3>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuenow={fini ? 1 : 0}
        aria-valuemin={0}
        aria-valuemax={1}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            phase === "erreur" ? "bg-destructive" : "bg-success",
          )}
          style={{ width: fini ? "100%" : "0%" }}
        />
      </div>

      <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm">
        {phase === "analyse" ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        ) : phase === "termine" ? (
          <CheckCircle2 className="size-4 shrink-0 text-success-ink" />
        ) : (
          <XCircle className="size-4 shrink-0 text-destructive" />
        )}
        <span className="min-w-0 flex-1 truncate" title={nom}>
          {nom}
        </span>
        <span
          className={cn(
            "shrink-0 text-xs",
            phase === "erreur" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {PHASE_LIBELLE[phase]}
        </span>
      </div>

      {phase === "analyse" && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="truncate text-xs text-muted-foreground">
            Reconnaissance de l&apos;objet et estimation du prix public… 5 à 20 secondes.
          </p>
          <div className="grid grid-cols-4 gap-2">
            {ETAPES_CADEAU.map((etape, i) => (
              <div key={etape} className="space-y-2">
                <div
                  className="h-1.5 animate-pulse rounded-full bg-border"
                  style={{ animationDelay: `${i * 160}ms` }}
                />
                <span className="rule-label block text-muted-foreground">{etape}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function LigneExtrait({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="border-b border-border/60 py-2.5 last:border-0 sm:grid sm:grid-cols-[7rem_1fr] sm:items-baseline sm:gap-4">
      <dt className="rule-label text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-foreground sm:mt-0">{valeur}</dd>
    </div>
  );
}

export function CadeauDeclaration({ onDeclare }: { onDeclare: () => void }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [apercu, setApercu] = useState<string | null>(null);
  const [estimation, setEstimation] = useState<CaptureEstimationCadeau | null>(null);
  const [phasePhoto, setPhasePhoto] = useState<PhasePhoto>("idle");
  const estimating = phasePhoto === "analyse";

  const [description, setDescription] = useState("");
  const [marque, setMarque] = useState("");
  const [dateReception, setDateReception] = useState(todayIso());
  const [valeur, setValeur] = useState("");
  const [contrepartie, setContrepartie] = useState("");
  const [corriger, setCorriger] = useState(false);
  const [noteOuverte, setNoteOuverte] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);

  function reinitialiser() {
    setPhoto(null);
    if (apercu) URL.revokeObjectURL(apercu);
    setApercu(null);
    setEstimation(null);
    setPhasePhoto("idle");
    setDescription("");
    setMarque("");
    setDateReception(todayIso());
    setValeur("");
    setContrepartie("");
    setCorriger(false);
    setNoteOuverte(false);
  }

  async function handlePhoto(fichier: File | null) {
    if (!fichier) return;
    setError(null);
    setSucces(null);
    setCorriger(false);
    setPhoto(fichier);
    if (apercu) URL.revokeObjectURL(apercu);
    setApercu(URL.createObjectURL(fichier));

    // Remise à zéro : la photo suivante écrase toujours l'extraction précédente.
    setDescription("");
    setMarque("");
    setValeur("");
    setContrepartie("");
    setEstimation(null);
    setDateReception(todayIso());

    setPhasePhoto("analyse");
    try {
      const est = await estimerCadeau(fichier);
      setEstimation(est);
      setDescription(est.description || est.objet_identifie || "");
      setMarque(est.marque || "");
      setValeur(valeurPreRemplie(est));
      // Si l'agent n'a pas assez extrait, on ouvre la correction pour ne pas bloquer.
      const desc = est.description || est.objet_identifie || "";
      const val = valeurPreRemplie(est);
      setCorriger(!desc || !val);
      setPhasePhoto("termine");
    } catch (err) {
      setPhasePhoto("erreur");
      setCorriger(true);
      setError(
        err instanceof Error
          ? err.message
          : "Estimation impossible — corrigez les champs ci-dessous.",
      );
    }
  }

  function onGiftFiles(files: FileList | File[]) {
    const fichier = files instanceof FileList ? files[0] : files[0];
    void handlePhoto(fichier ?? null);
  }

  const valeurNombre = Number(valeur.replace(",", "."));
  const valeurValide = Number.isFinite(valeurNombre) && valeurNombre > 0;
  const pretADeclarer =
    Boolean(photo) &&
    (phasePhoto === "termine" || phasePhoto === "erreur") &&
    description.trim().length > 0 &&
    valeurValide &&
    !saving;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pretADeclarer) return;
    setSaving(true);
    setError(null);
    setSucces(null);
    try {
      const res = await declarerCadeau({
        description: description.trim(),
        marque: marque.trim() || null,
        date_reception: dateReception || null,
        valeur_ttc: valeurNombre,
        devise: "EUR",
        contrepartie: contrepartie.trim() || null,
        photo,
        estimation,
      });
      setSucces(
        res.duplicate_skipped
          ? "Ce cadeau figurait déjà dans vos justificatifs — rien n'a été ajouté en double."
          : "Cadeau ajouté à vos justificatifs. Sa valeur sera reprise dans vos rapports et déclarations.",
      );
      reinitialiser();
      onDeclare();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Déclaration impossible.");
    } finally {
      setSaving(false);
    }
  }

  const extraitPret = phasePhoto === "termine" && Boolean(estimation);

  return (
    <div className="space-y-5">
      {/* Avant import, la carte entière réagit au survol comme la zone de dépôt
          « Documents » — même lavis accent, jusque sur la partie claire du haut. */}
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-border bg-card shadow-soft",
          !photo && "transition-colors duration-200 hover:bg-accent/5",
        )}
      >
        <div className="space-y-4 border-b border-border px-5 pb-4 pt-5">
          <h3 className="rule-label flex items-center gap-1.5 text-accent-ink">
            <Gift className="size-3" aria-hidden />
            Cadeaux et avantages en nature
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Un partenariat rémunéré en produits ou services («&nbsp;gifting&nbsp;») se déclare
            à sa valeur marchande — le prix public TTC — et entre au livre des recettes comme
            un encaissement.
          </p>
        </div>

        <GiftCadeauDrop
          onFiles={onGiftFiles}
          variant="panel"
          disabled={estimating || saving}
          preview={apercu}
          fileName={photo?.name ?? null}
          busy={estimating}
        />

        {photo && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="max-w-56 truncate">{photo.name}</span>
              <button
                type="button"
                onClick={reinitialiser}
                disabled={estimating || saving}
                className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                aria-label="Retirer la photo"
              >
                <X className="size-3.5" />
              </button>
            </span>
          </div>
        )}

        {extraitPret && estimation && (
          <form onSubmit={handleSubmit} className="space-y-5 border-t border-border p-5">
            {/* Ligne d'annonce. Un point coloré suffit à dire la confiance : un
                bandeau d'alerte pleine largeur criait plus fort que le chiffre
                qu'il qualifie, et une estimation moyenne reste une estimation
                utilisable — pas un incident. */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p className="rule-label text-muted-foreground">Extrait de la photo</p>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    TON_CONFIANCE[estimation.confiance] ?? "bg-muted-foreground",
                  )}
                  aria-hidden
                />
                {CONFIANCE_LABEL[estimation.confiance] ?? estimation.confiance}
              </span>
            </div>

            {/* Le montant d'abord : c'est la seule valeur que l'utilisateur
                confirme, et celle qui partira en déclaration. */}
            <div>
              <p className="font-mono text-4xl font-semibold tracking-tight proportional-nums">
                {valeurValide ? formatMoney(valeurNombre) : "—"}
                <span className="ml-2 align-baseline text-lg font-medium text-muted-foreground">
                  EUR
                </span>
              </p>
              <p className="num mt-1.5 text-xs text-muted-foreground">
                valeur TTC retenue
                {estimation.fourchette_min != null && estimation.fourchette_max != null &&
                  ` · fourchette estimée ${Math.round(estimation.fourchette_min)}–${Math.round(
                    estimation.fourchette_max,
                  )} €`}
              </p>
            </div>

            {/* Valeurs alignées à gauche : la description tient deux lignes et se
                lisait mal plaquée contre le bord droit. */}
            <dl className="border-t border-border pt-1">
              <LigneExtrait label="Description" valeur={description.trim() || "—"} />
              <LigneExtrait label="Marque" valeur={marque.trim() || "—"} />
              <LigneExtrait label="Reçu le" valeur={dateReception || "—"} />
            </dl>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <button
                type="button"
                onClick={() => setCorriger((c) => !c)}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                <Pencil className="size-3" />
                {corriger ? "Masquer la correction" : "Corriger une valeur"}
              </button>

              {/* Le commentaire du modèle et la mention de responsabilité restent
                  accessibles mais repliés : ils redisent en prose ce que le chiffre
                  et la fourchette montrent déjà, et n'appellent aucun geste. */}
              <button
                type="button"
                onClick={() => setNoteOuverte((n) => !n)}
                aria-expanded={noteOuverte}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                <Info className="size-3" />
                D&apos;où vient ce montant ?
              </button>
            </div>

            {noteOuverte && (
              <div className="animate-rise space-y-2 text-xs leading-relaxed text-muted-foreground">
                {estimation.message && <p>{estimation.message}</p>}
                <p>{estimation.avertissement}</p>
              </div>
            )}

            {corriger && (
              <div className="grid animate-rise gap-4 sm:grid-cols-2">
                <Champ label="Date reçue" htmlFor="cadeau-date">
                  <input
                    id="cadeau-date"
                    type="date"
                    value={dateReception}
                    onChange={(e) => setDateReception(e.target.value)}
                    className="input-boxed w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                  />
                </Champ>
                <Champ label="Description" htmlFor="cadeau-description" requis>
                  <input
                    id="cadeau-description"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="input-boxed w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                  />
                </Champ>
                <Champ label="Marque / client" htmlFor="cadeau-marque">
                  <input
                    id="cadeau-marque"
                    type="text"
                    value={marque}
                    onChange={(e) => setMarque(e.target.value)}
                    className="input-boxed w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                  />
                </Champ>
                <Champ label="Valeur TTC (€)" htmlFor="cadeau-valeur" requis>
                  <input
                    id="cadeau-valeur"
                    type="number"
                    min="0"
                    step="0.01"
                    value={valeur}
                    onChange={(e) => setValeur(e.target.value)}
                    className="input-boxed num w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                  />
                </Champ>
                <div className="sm:col-span-2">
                  <Champ label="Contrepartie attendue (optionnel)" htmlFor="cadeau-contrepartie">
                    <input
                      id="cadeau-contrepartie"
                      type="text"
                      value={contrepartie}
                      onChange={(e) => setContrepartie(e.target.value)}
                      placeholder="ex. 1 post Instagram + 2 stories"
                      className="input-boxed w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                    />
                  </Champ>
                </div>
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-2.5 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <Button type="submit" variant="accent" disabled={!pretADeclarer} className="w-full">
              {saving ? <Loader2 className="animate-spin" /> : <Gift />}
              {saving ? "Ajout…" : "Confirmer et ajouter"}
            </Button>
          </form>
        )}

        {succes && (
          <p className="border-t border-border px-5 py-4 text-sm text-success-ink">{succes}</p>
        )}

        {error && phasePhoto === "erreur" && (
          <div className="space-y-4 border-t border-border p-5">
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-2.5 text-sm text-destructive">
              {error}
            </p>
            <p className="text-xs text-muted-foreground">
              Importez une autre photo, ou corrigez manuellement si besoin.
            </p>
            {corriger && (
              <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
                <Champ label="Description" htmlFor="cadeau-description-err" requis>
                  <input
                    id="cadeau-description-err"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="input-boxed w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                  />
                </Champ>
                <Champ label="Valeur TTC (€)" htmlFor="cadeau-valeur-err" requis>
                  <input
                    id="cadeau-valeur-err"
                    type="number"
                    min="0"
                    step="0.01"
                    value={valeur}
                    onChange={(e) => setValeur(e.target.value)}
                    className="input-boxed num w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                  />
                </Champ>
                <Champ label="Marque / client" htmlFor="cadeau-marque-err">
                  <input
                    id="cadeau-marque-err"
                    type="text"
                    value={marque}
                    onChange={(e) => setMarque(e.target.value)}
                    className="input-boxed w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                  />
                </Champ>
                <div className="flex items-end sm:col-span-2">
                  <Button
                    type="submit"
                    variant="accent"
                    disabled={!(description.trim() && valeurValide) || saving}
                    className="w-full"
                  >
                    {saving ? <Loader2 className="animate-spin" /> : <Gift />}
                    Ajouter malgré l&apos;échec
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {photo && <AnalysePhoto nom={photo.name} phase={phasePhoto} />}
    </div>
  );
}

function Champ({
  label,
  htmlFor,
  requis = false,
  children,
}: {
  label: string;
  htmlFor: string;
  requis?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="rule-label mb-2 block text-muted-foreground">
        {label}
        {requis && <span className="ml-1 text-accent-ink">*</span>}
      </label>
      {children}
    </div>
  );
}
