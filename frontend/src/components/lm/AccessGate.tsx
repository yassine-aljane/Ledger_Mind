import { Link } from "@tanstack/react-router";
import { ArrowRight, Compass, LogIn, Sparkles, CircleCheckBig } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { PremiumPagePlaceholder, type PremiumKind } from "@/components/lm/PremiumPagePlaceholder";
import { Button } from "@/components/ui/button";
import { useEntitlements, type Feature } from "@/lib/entitlements";

/**
 * Barrière d'accès d'un écran entier.
 *
 * Le contrôle vit ICI, autour de la page, et jamais en tête de la page elle-même : sortir en
 * `return` avant les hooks de l'écran les rendrait conditionnels (ordre des hooks variable d'un
 * rendu à l'autre — bug React, signalé par `react-hooks/rules-of-hooks`). Avec cette barrière,
 * la page n'est pas montée quand elle est fermée : ni hooks, ni requêtes, ni redirection
 * d'authentification déclenchés pour rien.
 *
 * Chaque motif de fermeture a son écran, parce qu'ils appellent des gestes différents :
 * se connecter, s'abonner, finir son parcours, ou constater qu'il est déjà fini.
 */
export function AccessGate({
  feature,
  premiumKind,
  children,
}: {
  feature: Feature;
  /** Écran de démonstration à montrer au palier gratuit (paywall + aperçu). */
  premiumKind?: PremiumKind;
  children: ReactNode;
}) {
  const { lockReason, loading } = useEntitlements();

  // Avant hydratation, l'état réel est inconnu : afficher un refus ici ferait clignoter un
  // écran de blocage devant un utilisateur qui a pourtant les droits.
  if (loading) return <EcranAttente />;

  switch (lockReason(feature)) {
    case "auth":
      return <EcranConnexion />;
    case "premium":
      return premiumKind ? <PremiumPagePlaceholder kind={premiumKind} /> : <EcranPremium />;
    case "parcours":
      return <EcranParcoursIncomplet />;
    case "deja_fait":
      return <EcranParcoursTermine />;
    default:
      return <>{children}</>;
  }
}

function EcranAttente() {
  return (
    <AppShell>
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="rule-label text-muted-foreground">Chargement…</p>
      </div>
    </AppShell>
  );
}

/** Coquille commune aux écrans de blocage : même composition, message et geste différents. */
function EcranBloque({
  eyebrow,
  titre,
  accroche,
  texte,
  icone,
  action,
}: {
  eyebrow: string;
  titre: ReactNode;
  accroche: string;
  texte: string;
  icone: ReactNode;
  action: ReactNode;
}) {
  return (
    <AppShell>
      <PageHeader eyebrow={eyebrow} title={titre} description={accroche} />
      <div className="animate-rise mx-auto max-w-xl rounded-3xl border border-border bg-card p-8 text-center shadow-soft sm:p-12">
        <span className="mx-auto mb-6 inline-flex size-12 items-center justify-center rounded-2xl bg-accent/15 text-accent-ink">
          {icone}
        </span>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{texte}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">{action}</div>
      </div>
    </AppShell>
  );
}

function EcranConnexion() {
  return (
    <EcranBloque
      eyebrow="Espace membre"
      titre={
        <>
          Cet espace demande <span className="font-normal italic">un compte.</span>
        </>
      }
      accroche="Connectez-vous pour retrouver votre dossier."
      texte="L'Éducation reste ouverte sans compte : posez vos questions fiscales et consultez les
        sources autant que vous voulez. Le reste de LedgerMind s'appuie sur votre dossier, donc
        sur votre compte."
      icone={<LogIn className="size-5" />}
      action={
        <>
          <Button asChild size="lg" variant="accent">
            <Link to="/auth">
              Se connecter <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/education">Continuer sur l&apos;Éducation</Link>
          </Button>
        </>
      }
    />
  );
}

/** Repli quand aucun écran de démonstration n'existe pour la fonctionnalité demandée. */
function EcranPremium() {
  return (
    <EcranBloque
      eyebrow="Premium"
      titre={
        <>
          Cet espace fait partie de <span className="font-normal italic">Premium.</span>
        </>
      }
      accroche="Le gratuit sert à comprendre ; Premium sert à agir."
      texte="L'Éducation vous explique la règle. Premium ouvre le parcours fiscal, puis les outils
        qui l'appliquent à votre situation : diagnostic, échéances, documents, déclarations."
      icone={<Sparkles className="size-5" />}
      action={
        <>
          <Button asChild size="lg" variant="accent">
            <Link to="/premium">
              Découvrir Premium <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/education">Rester sur l&apos;Éducation</Link>
          </Button>
        </>
      }
    />
  );
}

function EcranParcoursIncomplet() {
  return (
    <EcranBloque
      eyebrow="Parcours fiscal"
      titre={
        <>
          Finissez votre parcours <span className="font-normal italic">d&apos;abord.</span>
        </>
      }
      accroche="Les outils s'appuient sur votre diagnostic."
      texte="Tableau de bord, documents, échéances et simulateur travaillent tous à partir de
        votre régime et de vos seuils. Tant que le parcours n'est pas terminé, ils n'auraient rien
        à afficher. Comptez une dizaine de minutes."
      icone={<Compass className="size-5" />}
      action={
        <Button asChild size="lg" variant="accent">
          <Link to="/onboarding">
            Reprendre le parcours <ArrowRight />
          </Link>
        </Button>
      }
    />
  );
}

function EcranParcoursTermine() {
  return (
    <EcranBloque
      eyebrow="Parcours fiscal"
      titre={
        <>
          C&apos;est déjà <span className="font-normal italic">fait.</span>
        </>
      }
      accroche="Votre dossier est instruit."
      texte="Votre diagnostic et votre feuille de route sont enregistrés — inutile de les refaire.
        Vos données restent modifiables depuis vos paramètres, sans repasser par tout le parcours."
      icone={<CircleCheckBig className="size-5" />}
      action={
        <>
          <Button asChild size="lg" variant="accent">
            <Link to="/dashboard">
              Aller au tableau de bord <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/parametres">Modifier mon profil</Link>
          </Button>
        </>
      }
    />
  );
}
