import { CalendarClock, Scale, Route as RouteIcon, TrendingUp, BookMarked, Layers } from "lucide-react";
import type { Roadmap } from "@/lib/types";
import { Badge, Card, SectionLabel } from "./ui-kit";
import { KeyValueList, humanKey, renderValue } from "./orchestrator";

function Block({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Scale;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="animate-rise p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-secondary text-foreground">
          <Icon className="size-4" />
        </span>
        <h3 className="text-lg">{title}</h3>
      </div>
      {children}
    </Card>
  );
}

function StepList({ items, label }: { items: Array<Record<string, unknown>>; label: string }) {
  return (
    <ol className="relative space-y-4 border-l border-border pl-6">
      {items.map((etape, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[31px] top-1 grid size-5 place-items-center rounded-full bg-primary font-mono text-[10px] text-primary-foreground">
            {i + 1}
          </span>
          <p className="font-medium text-foreground">
            {(etape.titre as string) || (etape.nom as string) || `${label} ${i + 1}`}
          </p>
          {etape.description || etape.detail ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {String(etape.description || etape.detail)}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {etape.echeance ? (
              <Badge tone="info">
                <CalendarClock className="size-3" /> {String(etape.echeance)}
              </Badge>
            ) : null}
            {etape.priorite ? <Badge tone="accent">{String(etape.priorite)}</Badge> : null}
            {etape.statut ? <Badge>{String(etape.statut)}</Badge> : null}
          </div>
          <KeyValueList
            data={etape}
            exclude={["titre", "nom", "description", "detail", "echeance", "priorite", "statut", "id"]}
            className="mt-2"
          />
        </li>
      ))}
    </ol>
  );
}

export function RoadmapView({ roadmap }: { roadmap: Roadmap }) {
  const bandeau = roadmap.bandeau;
  const etapes = (roadmap.etapes as Array<Record<string, unknown>>) ?? [];
  const phases = (roadmap.phases as Array<Record<string, unknown>>) ?? [];
  const etapesParcours = (roadmap.etapes_parcours as Array<Record<string, unknown>>) ?? [];
  const scenarios = (roadmap.scenarios as Array<Record<string, unknown>>) ?? [];
  const seuils = (roadmap.seuils_profil as Array<Record<string, unknown>>) ?? [];
  const sources = roadmap.legal_sources ?? [];

  return (
    <div className="space-y-6">
      {bandeau && (
        <Card className="animate-seal surface-ink overflow-hidden border-0 p-8">
          <p className="rule-label text-accent">{bandeau.type || "Votre situation"}</p>
          <h2 className="mt-3 max-w-3xl text-3xl text-ink-foreground sm:text-4xl">
            {bandeau.titre || "Feuille de route"}
          </h2>
          {bandeau.texte && (
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-foreground/75">{bandeau.texte}</p>
          )}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Régime recommandé", roadmap.regime_recommande],
          ["Catégorie", roadmap.categorie],
          ["Durabilité", roadmap.durabilite],
          ["Parcours", roadmap.parcours],
        ]
          .filter(([, v]) => !!v)
          .map(([label, value]) => (
            <Card key={String(label)} className="animate-rise p-5">
              <p className="rule-label text-muted-foreground">{label}</p>
              <p className="mt-2 font-display text-xl text-foreground">{String(value)}</p>
            </Card>
          ))}
      </div>

      {roadmap.analyse_juridique && (
        <Block icon={Scale} title="Analyse juridique">
          <KeyValueList data={roadmap.analyse_juridique as Record<string, unknown>} />
        </Block>
      )}

      {seuils.length > 0 && (
        <Block icon={TrendingUp} title="Seuils applicables à votre profil">
          <div className="grid gap-3 sm:grid-cols-2">
            {seuils.map((s, i) => (
              <div key={i} className="rounded-xl border border-border p-4">
                <KeyValueList data={s} />
              </div>
            ))}
          </div>
        </Block>
      )}

      {etapes.length > 0 && (
        <Block icon={RouteIcon} title="Vos étapes">
          <StepList items={etapes} label="Étape" />
        </Block>
      )}

      {phases.length > 0 && (
        <Block icon={Layers} title="Phases">
          <StepList items={phases} label="Phase" />
        </Block>
      )}

      {etapesParcours.length > 0 && (
        <Block icon={RouteIcon} title="Étapes du parcours">
          <StepList items={etapesParcours} label="Étape" />
        </Block>
      )}

      {scenarios.length > 0 && (
        <Block icon={TrendingUp} title="Scénarios">
          <div className="grid gap-4 md:grid-cols-2">
            {scenarios.map((s, i) => (
              <div key={i} className="rounded-xl border border-border bg-secondary/40 p-4">
                <p className="font-medium">{(s.titre as string) || (s.nom as string) || `Scénario ${i + 1}`}</p>
                <KeyValueList data={s} exclude={["titre", "nom"]} className="mt-2" />
              </div>
            ))}
          </div>
        </Block>
      )}

      {(["projections", "comparatif", "mixte", "prorata"] as const).map((key) =>
        roadmap[key] ? (
          <Block key={key} icon={TrendingUp} title={humanKey(key)}>
            {renderValue(roadmap[key])}
          </Block>
        ) : null,
      )}

      {Array.isArray(sources) && sources.length > 0 && (
        <Block icon={BookMarked} title="Sources légales">
          <ul className="space-y-2">
            {sources.map((s, i) => {
              if (typeof s === "string")
                return (
                  <li key={i} className="text-sm text-muted-foreground">
                    {s}
                  </li>
                );
              const rec = s as Record<string, unknown>;
              const url = rec.url as string | undefined;
              const label = (rec.titre as string) || (rec.source as string) || url || `Source ${i + 1}`;
              return (
                <li key={i} className="text-sm">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium text-foreground underline decoration-accent underline-offset-4"
                    >
                      {label}
                    </a>
                  ) : (
                    label
                  )}
                  {rec.date_publication ? (
                    <span className="ml-2 text-xs text-muted-foreground">{String(rec.date_publication)}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Block>
      )}

      {roadmap.meta && (
        <div className="rounded-2xl border border-dashed border-border p-4">
          <SectionLabel>Fraîcheur des données</SectionLabel>
          <KeyValueList data={roadmap.meta as Record<string, unknown>} className="mt-2" />
        </div>
      )}
    </div>
  );
}
