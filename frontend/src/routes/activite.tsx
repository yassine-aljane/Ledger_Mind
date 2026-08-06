import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AccessGate } from "@/components/lm/AccessGate";
import { AppShell, PageHeader } from "@/components/lm/AppShell";
import { FactureCycleVie } from "@/components/lm/FactureCycleVie";
import { fetchMe, getStoredUser, isAuthed, isSirenVerified } from "@/lib/auth";
import {
  fetchMySessions,
  fetchSessionDetail,
  getStoredSessionId,
  storeSessionId,
  type SessionDetail,
} from "@/lib/api";

export const Route = createFileRoute("/activite")({
  head: () => ({
    meta: [
      { title: "Facturation — LedgerMind" },
      {
        name: "description",
        content: "Factures émises et déclarations préparées, prêtes à signer.",
      },
    ],
  }),
  component: ActiviteRoute,
});

function ActiviteRoute() {
  return (
    <AccessGate feature="activite" premiumKind="activite">
      <ActivitePage />
    </AccessGate>
  );
}

function ActivitePage() {
  return <ActiviteGate />;
}

/** L'espace facture/déclaration ne concerne que les profils SIREN vérifiés — la guidance
 * (« pas encore immatriculé ») reste sur ses propres écrans, inchangés. */
function profileFromUser(user: ReturnType<typeof getStoredUser>) {
  const raw = user?.agent_context?.intake?.profile;
  if (!raw || typeof raw !== "object") return null;
  return raw as SessionDetail["profile"];
}

function ActiviteGate() {
  const navigate = useNavigate();
  const cachedUser = typeof window !== "undefined" ? getStoredUser() : null;
  const [profile, setProfile] = useState<SessionDetail["profile"] | null>(() =>
    profileFromUser(cachedUser),
  );
  // Cache-first : si le compte local dit déjà « SIREN vérifié », on affiche tout de suite —
  // plus de waterfall fetchMe → session/detail qui bloquait l'écran plusieurs secondes.
  const [loading, setLoading] = useState(() => !isSirenVerified(cachedUser));
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthed()) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        // Affichage immédiat depuis le cache, puis refresh réseau en arrière-plan.
        const local = getStoredUser();
        if (isSirenVerified(local)) {
          const localProfile = profileFromUser(local);
          if (localProfile && !cancelled) {
            setProfile(localProfile);
            setLoading(false);
          }
        }

        const me = await fetchMe();
        if (cancelled) return;

        let sessionId =
          getStoredSessionId() ||
          me.agent_context.intake.last_session_id ||
          me.agent_context.guidance.last_session_id ||
          null;
        if (!sessionId) {
          const sessions = await fetchMySessions();
          sessionId = sessions[0]?.session_id ?? null;
        }

        if (sessionId) {
          storeSessionId(sessionId);
          try {
            const d = await fetchSessionDetail(sessionId);
            if (!cancelled) setProfile(d.profile);
          } catch {
            // Identifiant appartenant à un autre compte (403) ou disparu (404) :
            // `fetchSessionDetail` vient de l'oublier. Le profil du compte suffit ici — il
            // porte déjà le SIREN vérifié — plutôt que de faire échouer tout l'écran.
            if (!cancelled) setProfile(profileFromUser(me));
          }
        } else if (!cancelled) {
          setProfile(profileFromUser(me));
        }
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          // Si le cache suffisait déjà, on garde l'écran utile ; sinon on montre l'erreur.
          if (isSirenVerified(getStoredUser()) && profileFromUser(getStoredUser())) {
            setLoading(false);
          } else {
            setLoadError(err instanceof Error ? err.message : "Impossible de charger votre dossier.");
            setLoading(false);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const isVerified = isSirenVerified(getStoredUser()) || profile?.verification_status === "verified";

  if (loading) {
    return (
      <AppShell>
        <PageHeader eyebrow="Facturation" title="Chargement…" />
      </AppShell>
    );
  }

  if (loadError) {
    return (
      <AppShell>
        <PageHeader eyebrow="Facturation" title="Connexion impossible" description={loadError} />
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground"
          >
            Réessayer
          </button>
        </div>
      </AppShell>
    );
  }

  if (!isVerified || !profile) {
    return (
      <AppShell>
        <PageHeader
          eyebrow="Facturation"
          title={
            <>
              Réservé aux profils <span className="italic font-normal">immatriculés.</span>
            </>
          }
          description="La facturation et les déclarations préparées s'appuient sur un SIREN vérifié — votre identité fiscale exacte (dénomination, forme juridique, régime)."
        />
        <div className="bg-card border border-border rounded-2xl p-10 text-center space-y-4">
          <p className="text-muted-foreground max-w-xl mx-auto">
            Votre profil n'est pas encore vérifié auprès du répertoire Sirene. Une fois la
            vérification faite, ce parcours (facture → déclaration) devient disponible.
          </p>
          <Link
            to="/onboarding/verification"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground shadow-soft transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]"
          >
            Lancer la vérification SIREN
          </Link>
        </div>
      </AppShell>
    );
  }

  return <ActiviteJourney profile={profile} />;
}

// La déclaration a désormais sa propre page (rail latéral) : cet écran ne porte plus qu'un
// seul sujet, la facture — d'où la disparition de la navigation par étapes.
function ActiviteJourney({ profile }: { profile: NonNullable<SessionDetail["profile"]> }) {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Facturation"
        title={
          <>
            Vos factures <span className="italic font-normal">émises.</span>
          </>
        }
        description={`${profile.denomination ?? "Votre activité"} · SIREN ${profile.siren ?? "—"} · ${
          profile.recommended_regime ?? profile.tax_category ?? "régime en cours de qualification"
        }`}
      />

      <EtapeFacture />
    </AppShell>
  );
}

// ------------------------------------------------------------------------------- 1. Facture

// Le cycle de vie complet (brouillon -> emission -> reglement / avoir) vit dans son propre
// composant : cet ecran n'est plus qu'un aiguillage entre les quatre etapes.
function EtapeFacture() {
  return <FactureCycleVie />;
}
