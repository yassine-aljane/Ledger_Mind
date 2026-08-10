/**
 * Déclaration d'un cadeau / avantage en nature reçu d'une marque (« gifting »).
 *
 * Human-in-the-loop assumé de bout en bout : la photo passe au modèle de vision, qui
 * PROPOSE un objet et une valeur ; l'utilisateur relit, corrige, puis déclare. Rien
 * n'est enregistré tant qu'il n'a pas validé, et le serveur refuse une déclaration
 * qui ne porte pas sa confirmation.
 *
 * D'où deux partis pris d'interface :
 *  - la suggestion s'affiche dans un encart distinct du formulaire, jamais comme un
 *    champ déjà « bon » : le lecteur doit voir d'un coup d'œil ce qui vient de la
 *    machine et ce qu'il a saisi lui-même ;
 *  - le niveau de confiance est écrit en toutes lettres, pas seulement porté par une
 *    couleur, et une confiance basse ne pré-remplit pas le montant.
 */

import { useState } from "react";
import {
  Camera,
  Check,
  CheckCircle2,
  Gift,
  Info,
  Loader2,
  Pencil,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

/**
 * Montant pré-rempli dans le champ, quelle que soit la confiance.
 *
 * Le champ reste entièrement modifiable et l'encart d'avertissement demeure au-dessus :
 * partir d'un chiffre à corriger fait gagner du temps sur la quasi-totalité des cas, là
 * où un champ vide oblige à retaper une valeur que le modèle vient d'afficher.
 *
 * À défaut de valeur unique, on prend le MILIEU de la fourchette : c'est le seul point
 * qu'on puisse en tirer sans privilégier arbitrairement le bas ou le haut. Le libellé
 * sous le champ dit d'où vient le chiffre, pour qu'un milieu de fourchette large ne
 * passe jamais pour un prix constaté.
 */
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
      <h3 className="rule-label-lg text-label-ink">Analyse du cadeau · {fini ? 1 : 0}/1</h3>

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

      <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[0.9375rem]">
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
            "shrink-0 text-[0.8125rem]",
            phase === "erreur" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {PHASE_LIBELLE[phase]}
        </span>
      </div>

      {phase === "analyse" && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="truncate text-[0.8125rem] text-muted-foreground">
            Reconnaissance de l&apos;objet et estimation du prix public… 5 à 20 secondes.
          </p>
          <div className="grid grid-cols-4 gap-2">
            {ETAPES_CADEAU.map((etape, i) => (
              <div key={etape} className="space-y-2">
                <div
                  className="h-1.5 animate-pulse rounded-full bg-border"
                  style={{ animationDelay: `${i * 160}ms` }}
                />
                <span className="rule-label-lg block text-label-ink">{etape}</span>
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
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <span className="rule-label-lg shrink-0 text-label-ink">{label}</span>
      <span className="min-w-0 text-right text-[0.9375rem] font-medium text-foreground">{valeur}</span>
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
  // Repliée par défaut : ce qui vient de la machine se relit d'abord, et ne s'ouvre à la
  // correction que sur demande — ou d'office quand l'extraction est trop incomplète pour
  // qu'on puisse déclarer en l'état.
  const [corriger, setCorriger] = useState(false);

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
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <div className="space-y-4 border-b border-border px-5 pb-4 pt-5">
          <h3 className="rule-label-lg flex items-center gap-1.5 text-accent-ink">
            <Gift className="size-3" aria-hidden />
            Cadeaux et avantages en nature
          </h3>
          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
            Un partenariat rémunéré en produits ou services («&nbsp;gifting&nbsp;») se déclare
            à sa valeur marchande — le prix public TTC — et entre au livre des recettes comme
            un encaissement.
          </p>
        </div>

      {/* Photo : point de départ facultatif. Sans elle, le formulaire reste saisissable.
          La scène cadeau porte elle-même son input, l'aperçu, le nom du fichier et l'état
          d'analyse — dupliquer l'aperçu ici afficherait deux fois la même photo. */}
      <div className="px-5 pt-4">
        <GiftCadeauDrop
          variant="panel"
          onFiles={(fichiers) => void handlePhoto(Array.from(fichiers)[0] ?? null)}
          preview={apercu}
          fileName={photo?.name ?? null}
          busy={estimating}
          disabled={saving}
        />

        {photo && (
          <div className="flex justify-end pt-3">
            <button
              type="button"
              onClick={reinitialiser}
              disabled={estimating || saving}
              className="inline-flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
            >
              <X className="size-3.5" />
              Retirer la photo
            </button>
          </div>
        )}
      </div>

        {extraitPret && estimation && (
          <form onSubmit={handleSubmit} className="space-y-5 border-t border-border p-5">
            <div
              className={cn(
                "space-y-3 rounded-xl border p-4",
                estimation.confiance === "haute"
                  ? "border-success/40 bg-success/8"
                  : "border-warning/40 bg-warning/8",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={estimation.confiance === "haute" ? "success" : "warning"}>
                  {estimation.confiance === "haute" ? <Check /> : <TriangleAlert />}
                  Extrait · {CONFIANCE_LABEL[estimation.confiance] ?? estimation.confiance}
                </Badge>
                <span className="text-[0.8125rem] font-medium text-foreground">
                  vérifiez puis ajoutez
                </span>
              </div>
              <p className="text-[0.9375rem] leading-relaxed text-foreground">{estimation.message}</p>


              {estimation.fourchette_min != null && estimation.fourchette_max != null && (
                <p className="num text-[0.8125rem] text-muted-foreground">
                  Fourchette estimée : {Math.round(estimation.fourchette_min)}–
                  {Math.round(estimation.fourchette_max)} €
                </p>
              )}
              <p className="flex items-start gap-1.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                {estimation.avertissement}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setCorriger((c) => !c)}
              className="inline-flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              <Pencil className="size-3" />
              {corriger ? "Masquer la correction" : "Corriger une valeur"}
            </button>

            {corriger && (
              <div className="grid animate-rise gap-4 sm:grid-cols-2">
                <Champ label="Date reçue" htmlFor="cadeau-date">
                  <input
                    id="cadeau-date"
                    type="date"
                    value={dateReception}
                    onChange={(e) => setDateReception(e.target.value)}
                    className="input-boxed w-full rounded-xl border border-border bg-background px-3 py-2 text-[0.9375rem] focus:outline-none"
                  />
                </Champ>
                <Champ label="Description" htmlFor="cadeau-description" requis>
                  <input
                    id="cadeau-description"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="input-boxed w-full rounded-xl border border-border bg-background px-3 py-2 text-[0.9375rem] focus:outline-none"
                  />
                </Champ>
                <Champ label="Marque / client" htmlFor="cadeau-marque">
                  <input
                    id="cadeau-marque"
                    type="text"
                    value={marque}
                    onChange={(e) => setMarque(e.target.value)}
                    className="input-boxed w-full rounded-xl border border-border bg-background px-3 py-2 text-[0.9375rem] focus:outline-none"
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
                    className="input-boxed num w-full rounded-xl border border-border bg-background px-3 py-2 text-[0.9375rem] focus:outline-none"
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
                      className="input-boxed w-full rounded-xl border border-border bg-background px-3 py-2 text-[0.9375rem] focus:outline-none"
                    />
                  </Champ>
                </div>
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-2.5 text-[0.9375rem] text-destructive"
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
          <p className="border-t border-border px-5 py-4 text-[0.9375rem] text-success-ink">{succes}</p>
        )}

        {error && phasePhoto === "erreur" && (
          <div className="space-y-4 border-t border-border p-5">
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-2.5 text-[0.9375rem] text-destructive">
              {error}
            </p>
            <p className="text-[0.8125rem] text-muted-foreground">
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
                    className="input-boxed w-full rounded-xl border border-border bg-background px-3 py-2 text-[0.9375rem] focus:outline-none"
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
                    className="input-boxed num w-full rounded-xl border border-border bg-background px-3 py-2 text-[0.9375rem] focus:outline-none"
                  />
                </Champ>
                <Champ label="Marque / client" htmlFor="cadeau-marque-err">
                  <input
                    id="cadeau-marque-err"
                    type="text"
                    value={marque}
                    onChange={(e) => setMarque(e.target.value)}
                    className="input-boxed w-full rounded-xl border border-border bg-background px-3 py-2 text-[0.9375rem] focus:outline-none"
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
      <label htmlFor={htmlFor} className="rule-label-lg mb-2 block text-label-ink">
        {label}
        {requis && <span className="ml-1 text-accent-ink">*</span>}
      </label>
      {children}
    </div>
  );
}
