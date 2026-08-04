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

import { useRef, useState } from "react";
import {
  Camera,
  Check,
  CheckCircle2,
  Gift,
  Info,
  Loader2,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  declarerCadeau,
  estimerCadeau,
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

/** D'où vient le montant actuellement dans le champ — affiché sous celui-ci. */
function origineValeur(est: CaptureEstimationCadeau | null, valeur: number): string {
  if (!est) return "Prix public TTC de l'objet à l'état neuf.";

  if (est.valeur_estimee != null) {
    return Math.abs(valeur - est.valeur_estimee) > 0.01
      ? `Vous déclarez une valeur différente de l'estimation (${Math.round(
          est.valeur_estimee,
        )} €) — c'est la vôtre qui fait foi.`
      : "Valeur proposée par l'estimation, que vous confirmez. Modifiable.";
  }

  if (est.fourchette_min != null && est.fourchette_max != null) {
    const milieu = Math.round((est.fourchette_min + est.fourchette_max) / 2);
    const large = est.fourchette_max >= est.fourchette_min * 2;
    if (Math.abs(valeur - milieu) > 0.01) {
      return "Valeur que vous avez saisie — c'est elle qui sera déclarée.";
    }
    return large
      ? `Milieu d'une fourchette très large (${Math.round(est.fourchette_min)}–${Math.round(
          est.fourchette_max,
        )} €) : ce n'est pas un prix constaté, ajustez-le au prix public réel.`
      : `Milieu de la fourchette estimée — ajustez au prix public réel.`;
  }

  // Borne basse seule : le champ la reprend, il faut dire que c'est un PLANCHER et
  // non un prix, sinon le montant déclaré sera systématiquement sous-évalué.
  if (est.fourchette_min != null) {
    return Math.abs(valeur - est.fourchette_min) > 0.01
      ? "Valeur que vous avez saisie — c'est elle qui sera déclarée."
      : `Estimation minimale (${Math.round(
          est.fourchette_min,
        )} €) : le prix réel est probablement plus élevé, vérifiez-le.`;
  }

  return "Prix public TTC de l'objet à l'état neuf.";
}

/**
 * Étapes de l'analyse d'une photo de cadeau.
 *
 * Ce ne sont PAS les cinq étapes d'un justificatif : il n'y a ni OCR ni classification
 * ici — une photo de bijou ne porte aucun texte à lire. Nommer les vraies étapes plutôt
 * que recopier celles du dépôt de document évite de promettre un traitement qui n'a pas
 * lieu, tout en gardant le même geste visuel.
 */
const ETAPES_CADEAU = ["Lecture", "Reconnaissance", "Estimation", "Contrôle"];

type PhasePhoto = "idle" | "analyse" | "termine" | "erreur";

const PHASE_LIBELLE: Record<Exclude<PhasePhoto, "idle">, string> = {
  analyse: "Analyse en cours",
  termine: "Terminé",
  erreur: "Échec",
};

/** Panneau d'avancement, dans la même langue visuelle que le dépôt de justificatifs. */
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
          {/* Les barres pulsent en décalé : le traitement est un seul appel au modèle,
              on signale donc une attente, sans simuler une progression qu'on ne mesure pas. */}
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

export function CadeauDeclaration({ onDeclare }: { onDeclare: () => void }) {
  const photoRef = useRef<HTMLInputElement>(null);

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
    if (photoRef.current) photoRef.current.value = "";
  }

  async function handlePhoto(fichier: File | null) {
    if (!fichier) return;
    setError(null);
    setSucces(null);
    setPhoto(fichier);
    if (apercu) URL.revokeObjectURL(apercu);
    setApercu(URL.createObjectURL(fichier));

    setPhasePhoto("analyse");
    try {
      const est = await estimerCadeau(fichier);
      setEstimation(est);
      // On ne remplit que ce qui est vide : une saisie déjà faite par l'utilisateur
      // prime toujours sur la proposition de la machine.
      setDescription((d) => d || est.description || est.objet_identifie || "");
      setMarque((m) => m || est.marque || "");
      setValeur((v) => v || valeurPreRemplie(est));
      setPhasePhoto("termine");
    } catch (err) {
      setPhasePhoto("erreur");
      setError(
        err instanceof Error
          ? err.message
          : "Estimation impossible — renseignez les champs à la main.",
      );
    }
  }

  const valeurNombre = Number(valeur.replace(",", "."));
  const valeurValide = Number.isFinite(valeurNombre) && valeurNombre > 0;
  const pretADeclarer = description.trim().length > 0 && valeurValide && !saving;

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

  return (
    <>
      {/* Même réaction au survol que la zone de dépôt voisine : les deux blocs sont
          deux façons de faire entrer une pièce, ils doivent se comporter pareil. */}
      <section className="animate-rise space-y-5 rounded-2xl border border-border bg-card p-6 shadow-soft transition-all duration-200 hover:border-accent hover:bg-accent/5">
      <div>
        <h3 className="rule-label flex items-center gap-1.5 text-accent-ink">
          <Gift className="size-3" aria-hidden />
          Cadeaux et avantages en nature
        </h3>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
          Un partenariat rémunéré en produits ou services («&nbsp;gifting&nbsp;») se déclare
          à sa valeur marchande — le prix public TTC — et entre au livre des recettes comme
          un encaissement.
        </p>
      </div>

      {/* Photo : point de départ facultatif. Sans elle, le formulaire reste saisissable. */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => handlePhoto(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full border-dashed"
          disabled={estimating}
          onClick={() => photoRef.current?.click()}
        >
          {estimating ? <Loader2 className="animate-spin" /> : <Camera />}
          {estimating
            ? "Analyse de la photo…"
            : photo
              ? "Changer la photo"
              : "Remplir depuis une photo du cadeau"}
        </Button>
        {photo && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="max-w-[12rem] truncate">{photo.name}</span>
            <button
              type="button"
              onClick={reinitialiser}
              className="text-muted-foreground transition-colors hover:text-destructive"
              aria-label="Retirer la photo"
            >
              <X className="size-3.5" />
            </button>
          </span>
        )}
      </div>

      {apercu && (
        <img
          src={apercu}
          alt="Aperçu du cadeau déposé"
          className="max-h-40 rounded-xl border border-border object-contain"
        />
      )}


      {/* La suggestion vit dans son propre encart, séparée des champs : ce qui vient
          de la machine ne doit jamais se confondre avec ce que l'utilisateur déclare. */}
      {estimation && (
        <div
          className={cn(
            "space-y-2 rounded-xl border p-4",
            estimation.confiance === "haute"
              ? "border-success/40 bg-success/8"
              : "border-warning/40 bg-warning/8",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={estimation.confiance === "haute" ? "success" : "warning"}>
              {estimation.confiance === "haute" ? <Check /> : <TriangleAlert />}
              Suggestion · {CONFIANCE_LABEL[estimation.confiance] ?? estimation.confiance}
            </Badge>
            <span className="text-xs font-medium text-foreground">à vérifier avant d&apos;ajouter</span>
          </div>
          <p className="text-sm leading-relaxed text-foreground">{estimation.message}</p>
          {estimation.fourchette_min != null && estimation.fourchette_max != null && (
            <p className="num text-xs text-muted-foreground">
              Fourchette estimée : {Math.round(estimation.fourchette_min)}–
              {Math.round(estimation.fourchette_max)} €
            </p>
          )}
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
            {estimation.avertissement}
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
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
              placeholder="ex. bracelet et bague assortis"
              className="input-boxed w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none"
            />
          </Champ>
          <Champ label="Marque / client" htmlFor="cadeau-marque">
            <input
              id="cadeau-marque"
              type="text"
              value={marque}
              onChange={(e) => setMarque(e.target.value)}
              placeholder="ex. Youhave Jewellery"
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
              placeholder="0,00"
              aria-describedby="cadeau-valeur-aide"
              className="input-boxed num w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none"
            />
            <p id="cadeau-valeur-aide" className="mt-1.5 text-xs text-muted-foreground">
              {valeurValide
                ? origineValeur(estimation, valeurNombre)
                : "Prix public TTC de l'objet à l'état neuf."}
            </p>
          </Champ>
        </div>

        <Champ label="Contrepartie attendue" htmlFor="cadeau-contrepartie">
          <input
            id="cadeau-contrepartie"
            type="text"
            value={contrepartie}
            onChange={(e) => setContrepartie(e.target.value)}
            placeholder="ex. 1 post Instagram + 2 stories"
            className="input-boxed w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none"
          />
        </Champ>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-2.5 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {succes && (
          <p className="rounded-xl border border-success/30 bg-success/8 px-4 py-2.5 text-sm text-success-ink">
            {succes}
          </p>
        )}

        {/* « Ajouter » et non « Déclarer » : ce geste fait entrer une pièce dans les
            justificatifs, au même titre qu'un dépôt de facture. La déclaration, elle,
            se joue plus tard — au rapport et à la déclaration fiscale, qui reprendront
            cette valeur. Nommer le bouton « Déclarer » ici laisserait croire que la
            démarche fiscale est faite. */}
        <Button type="submit" variant="accent" disabled={!pretADeclarer} className="w-full">
          {saving ? <Loader2 className="animate-spin" /> : <Gift />}
          {saving ? "Ajout…" : "Ajouter ce cadeau"}
        </Button>
      </form>
      </section>

      {/* Le suivi d'analyse se place SOUS le bloc cadeau, comme celui des justificatifs
          se place sous sa zone de dépôt : chaque panneau suit son propre déclencheur. */}
      {photo && <AnalysePhoto nom={photo.name} phase={phasePhoto} />}
    </>
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
