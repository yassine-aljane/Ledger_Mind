import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { HardDrive, Loader2, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { MarketingLayout } from "@/components/lm/Marketing";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { revoquerSession } from "@/lib/auth";
import { GROUPES, effacer, lireEtat, type Etat, type Groupe } from "@/lib/traceurs";

/**
 * « Mes données sur cet appareil » — transparence et contrôle sur le stockage local.
 *
 * Ce n'est PAS une fenêtre de consentement, et il ne faut pas la transformer en cela : tous les
 * traceurs de LedgerMind sont strictement nécessaires (voir `/cookies`), donc non refusables sans
 * casser le service. Demander une autorisation qu'on ne peut pas refuser serait un consentement
 * de façade. Ce que cet écran offre à la place est réel : voir ce qui existe, et l'effacer.
 *
 * L'inventaire est lu à l'exécution, pas déclaré : ce sont les clés réellement présentes qui sont
 * affichées, y compris celles qu'aucune entrée du catalogue ne décrit — c'est le filet contre une
 * politique de confidentialité qui aurait pris du retard sur le code.
 */

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="rule-label text-muted-foreground">
      <span className="mr-2 inline-block h-px w-6 -translate-y-[3px] bg-accent align-middle" />
      {children}
    </p>
  );
}

function formatOctets(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  return `${(octets / 1024).toFixed(1)} Ko`;
}

/** Un groupe du catalogue, confronté à ce qui se trouve réellement sur l'appareil. */
function CarteGroupe({ groupe, etat }: { groupe: Groupe; etat: Etat }) {
  return (
    <div className="animate-rise rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h3 className="text-lg">{groupe.titre}</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">{groupe.intro}</p>
        </div>
        {!groupe.essentiel && (
          <span className="rule-label shrink-0 rounded-full border border-border px-2.5 py-1 text-muted-foreground">
            Effaçable sans conséquence
          </span>
        )}
      </div>

      <ul className="divide-y divide-border/60">
        {groupe.traceurs.map((traceur) => {
          const presences = etat.parTraceur.get(traceur.nom) ?? [];
          const present = presences.length > 0;
          return (
            <li key={traceur.nom} className="px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <code className="num text-xs break-all">{traceur.nom}</code>
                {/* Un cookie `httpOnly` est invisible à JavaScript : afficher « Absent » ferait
                    croire qu'il n'existe pas, alors que la session peut être bien ouverte. */}
                {traceur.observable === false ? (
                  <span className="shrink-0 text-xs text-muted-foreground/70">
                    Non lisible depuis cette page
                  </span>
                ) : present ? (
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    {presences.length > 1 ? `${presences.length} entrées · ` : ""}
                    {formatOctets(presences.reduce((n, p) => n + p.octets, 0))}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground/70">Absent</span>
                )}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {traceur.finalite}
              </p>
              {/* Les clés à préfixe (une par compte) sont montrées telles qu'elles existent :
                  sans cela, l'utilisateur ne saurait pas combien de comptes ont servi ici. */}
              {presences.length > 0 && presences.some((p) => p.cle !== traceur.nom) && (
                <p className="num mt-2 text-xs break-all text-muted-foreground/80">
                  {presences.map((p) => p.cle).join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const Route = createFileRoute("/mes-donnees")({
  head: () => ({
    meta: [
      { title: "Mes données sur cet appareil — LedgerMind" },
      {
        name: "description",
        content:
          "Voyez exactement ce que LedgerMind enregistre sur votre appareil, et effacez-le quand vous voulez.",
      },
    ],
  }),
  component: MesDonnees,
});

function MesDonnees() {
  const navigate = useNavigate();
  // `null` = pas encore lu. Le stockage n'existe pas au rendu serveur : afficher un inventaire
  // vide avant hydratation ferait croire, l'espace d'un instant, que rien n'est enregistré.
  const [etat, setEtat] = useState<Etat | null>(null);
  const [occupe, setOccupe] = useState(false);

  const rafraichir = useCallback(() => setEtat(lireEtat()), []);

  useEffect(() => {
    rafraichir();
  }, [rafraichir]);

  const effacerConfort = () => {
    const n = effacer("confort");
    rafraichir();
    toast.success(
      n === 0
        ? "Aucune préférence d'affichage à effacer."
        : `${n} préférence${n > 1 ? "s" : ""} d'affichage effacée${n > 1 ? "s" : ""}.`,
    );
  };

  /**
   * Efface l'appareil ET révoque la session.
   *
   * Les deux moitiés sont nécessaires : le cookie de session est `httpOnly`, donc hors d'atteinte
   * de `effacer()`. Sans l'appel au serveur, l'interface repasserait en visiteur alors que la
   * session resterait ouverte — un écran qui promet « tout effacer » ne peut pas se permettre ça.
   *
   * Si la révocation échoue (hors ligne), on efface quand même localement, mais on le dit : mieux
   * vaut un avertissement exact qu'une confirmation fausse.
   */
  const effacerTout = async () => {
    setOccupe(true);
    const revoquee = await revoquerSession();
    const n = effacer("tout");
    if (revoquee) {
      toast.success(`${n} élément${n > 1 ? "s" : ""} effacé${n > 1 ? "s" : ""} et session fermée.`);
    } else {
      toast.warning(
        "Données effacées de cet appareil, mais la session n'a pas pu être fermée sur nos serveurs — réessayez une fois reconnecté à Internet.",
      );
    }
    navigate({ to: "/", replace: true });
  };

  const total = etat ? etat.total : 0;

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-4xl px-5 py-14 sm:py-20">
        <header className="animate-rise max-w-2xl">
          <SectionLabel>Confidentialité</SectionLabel>
          <h1 className="mt-4 text-[clamp(2rem,4.5vw,3.2rem)] leading-[1.05]">
            Mes données sur <span className="text-safran italic">cet appareil</span>
          </h1>
          <p className="mt-5 text-muted-foreground">
            Cette page lit votre navigateur en direct et affiche ce que LedgerMind y a enregistré.
            Rien n&apos;est envoyé nulle part pour l&apos;établir : l&apos;inventaire est calculé
            chez vous.
          </p>
        </header>

        {/* Bandeau d'état + actions */}
        <div className="animate-rise mt-10 flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
              <HardDrive className="size-4" />
            </span>
            <div>
              <p className="font-medium">
                {etat === null
                  ? "Lecture de l'appareil…"
                  : `${total} élément${total > 1 ? "s" : ""} lisible${total > 1 ? "s" : ""}`}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Aucun ne sert à la publicité ni à la mesure d&apos;audience —{" "}
                <Link to="/cookies" className="underline underline-offset-4 hover:text-foreground">
                  voir la politique cookies
                </Link>
                .
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={rafraichir}
            disabled={etat === null}
            className="shrink-0"
          >
            <RefreshCw className="size-3.5" /> Actualiser
          </Button>
        </div>

        {etat === null ? (
          <div className="mt-10 flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Inventaire en cours…
          </div>
        ) : (
          <>
            <div className="mt-10 space-y-5">
              {GROUPES.map((groupe) => (
                <CarteGroupe key={groupe.id} groupe={groupe} etat={etat} />
              ))}
            </div>

            {/* Clés hors catalogue : signalées plutôt que masquées. */}
            {etat.nonRepertoriees.length > 0 && (
              <div className="animate-rise mt-5 rounded-2xl border border-dashed border-border p-5 sm:p-6">
                <h3 className="flex items-center gap-2 text-lg">
                  <TriangleAlert className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  Autres éléments présents
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Ces clés ne figurent pas dans notre inventaire. Elles peuvent provenir d&apos;une
                  extension de navigateur, d&apos;un autre site partageant cette adresse, ou
                  d&apos;une fonctionnalité récente dont la documentation est en retard. Elles sont
                  listées ici plutôt que masquées, et l&apos;effacement complet les emporte aussi.
                </p>
                <ul className="mt-4 space-y-1.5">
                  {etat.nonRepertoriees.map((p) => (
                    <li
                      key={`${p.support}:${p.cle}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 text-xs"
                    >
                      <code className="num break-all">{p.cle}</code>
                      <span className="num shrink-0 text-muted-foreground">
                        {p.support} · {formatOctets(p.octets)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Actions destructrices — séparées visuellement du reste. */}
            <div className="animate-rise mt-10 rounded-2xl border border-border bg-card p-6 shadow-soft sm:p-8">
              <h2 className="text-2xl">Effacer</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                « Tout effacer » nettoie cet appareil{" "}
                <span className="font-medium text-foreground">et ferme votre session</span> sur nos
                serveurs — c&apos;est la seule façon d&apos;annuler un cookie de connexion, que
                votre navigateur ne peut pas retirer lui-même.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                En revanche, votre dossier en ligne — justificatifs, factures, rapports — reste
                intact : vous le retrouverez en vous reconnectant. Sa suppression définitive se
                demande séparément, via le contact indiqué dans la{" "}
                <Link
                  to="/confidentialite"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  politique de confidentialité
                </Link>
                .
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button variant="outline" onClick={effacerConfort} className="sm:w-auto">
                  Effacer les préférences d&apos;affichage
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={occupe} className="sm:w-auto">
                      {occupe ? <Loader2 className="animate-spin" /> : <Trash2 className="size-4" />}
                      Tout effacer
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Tout effacer et fermer la session ?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Votre session sera fermée sur nos serveurs, et le parcours en cours ainsi
                        que les brouillons de simulation enregistrés sur ce navigateur seront
                        perdus. Votre compte et les données de votre dossier en ligne ne sont pas
                        affectés : vous pourrez vous reconnecter et les retrouver.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction onClick={effacerTout}>
                        Tout effacer et se déconnecter
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </>
        )}

        <div className="mt-16 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            Cet écran n&apos;est pas une demande de consentement : les éléments listés sont
            nécessaires au service, pas optionnels.
          </p>
          <Link to="/cookies" className="shrink-0 transition-colors hover:text-foreground">
            Politique cookies
          </Link>
        </div>
      </div>
    </MarketingLayout>
  );
}
