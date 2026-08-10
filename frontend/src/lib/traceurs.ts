/**
 * Catalogue des traceurs déposés sur l'appareil, et outils pour les inspecter et les effacer.
 *
 * Source unique de vérité : la page `/cookies` l'affiche comme inventaire réglementaire, et la
 * page `/mes-donnees` s'en sert pour montrer ce qui est RÉELLEMENT présent puis l'effacer. Deux
 * listes séparées auraient dérivé — et une politique qui décrit des traceurs inexistants, ou qui
 * en oublie, est aussi fautive qu'une politique absente.
 *
 * Toute nouvelle clé de stockage doit donc être ajoutée ici en même temps qu'elle est introduite.
 * L'écran `/mes-donnees` signale d'ailleurs les clés non répertoriées : c'est le filet.
 */

export type Support = "Cookie" | "Stockage local" | "Stockage de session";

/** `exacte` : la clé est écrite telle quelle. `prefixe` : la clé est suffixée à l'exécution
 *  (la formule est stockée par compte, `lm.plan.<identifiant>`). */
export type Correspondance = "exacte" | "prefixe";

export type Traceur = {
  /** Libellé affiché — peut porter une partie variable, contrairement à `cle`. */
  nom: string;
  /** Clé réelle, ou préfixe de clé selon `correspondance`. */
  cle: string;
  correspondance: Correspondance;
  support: Support;
  finalite: string;
  duree: string;
  /**
   * `false` pour un cookie `httpOnly` : le navigateur l'envoie au serveur mais l'interdit à
   * JavaScript. Il doit donc figurer dans l'inventaire réglementaire — un cookie non documenté
   * reste un manquement, qu'on puisse le lire ou non — mais `/mes-donnees` ne peut ni constater
   * sa présence ni l'effacer, et doit le dire au lieu d'afficher « Absent ».
   *
   * Absent = observable (cas général).
   */
  observable?: false;
};

export type Groupe = {
  id: "compte" | "parcours" | "confort";
  titre: string;
  intro: string;
  /** Un groupe non essentiel peut être effacé sans conséquence sur la session. */
  essentiel: boolean;
  traceurs: Traceur[];
};

export const GROUPES: Groupe[] = [
  {
    id: "compte",
    titre: "Votre compte et votre session",
    intro:
      "Sans eux, il est impossible de rester connecté : chaque page vous redemanderait votre mot de passe.",
    essentiel: true,
    traceurs: [
      {
        nom: "ledgermind_session",
        cle: "ledgermind_session",
        correspondance: "exacte",
        support: "Cookie",
        finalite:
          "Vous garde connecté d'une page à l'autre et authentifie vos appels au service. Ce cookie est « httpOnly » : votre navigateur l'envoie à LedgerMind, mais aucun script de la page ne peut le lire — c'est ce qui protège votre session en cas de code malveillant injecté dans le site.",
        duree: "14 jours, ou jusqu'à la déconnexion",
        observable: false,
      },
      {
        nom: "ledgermind_access_token",
        cle: "ledgermind_access_token",
        correspondance: "exacte",
        support: "Stockage local",
        finalite:
          "Ancien emplacement du jeton de connexion, avant son passage en cookie sécurisé. Plus rien ne l'écrit : il n'existe que sur les navigateurs utilisés avant ce changement, et la déconnexion le supprime.",
        duree: "Jusqu'à la prochaine déconnexion ou l'effacement des données du navigateur",
      },
      {
        nom: "ledgermind_user",
        cle: "ledgermind_user",
        correspondance: "exacte",
        support: "Stockage local",
        finalite:
          "Mémorise l'identité du compte utilisé (nom, adresse email) pour l'afficher et rattacher votre dossier au bon compte.",
        duree: "Jusqu'à la déconnexion ou l'effacement des données du navigateur",
      },
      {
        nom: "lm.plan.<identifiant du compte>",
        cle: "lm.plan",
        correspondance: "prefixe",
        support: "Stockage local",
        finalite:
          "Retient la formule active (gratuite ou Premium) pour le compte utilisé sur ce navigateur.",
        duree: "Jusqu'à l'effacement des données du navigateur",
      },
      {
        nom: "lm.plan.pending",
        cle: "lm.plan.pending",
        correspondance: "exacte",
        support: "Stockage local",
        finalite:
          "Conserve une demande de passage en Premium formulée avant connexion, afin de l'honorer une fois le compte identifié.",
        duree: "Effacé dès la connexion suivante",
      },
    ],
  },
  {
    id: "parcours",
    titre: "Continuité de votre parcours",
    intro:
      "Ils évitent de vous faire tout recommencer quand vous changez d'écran ou revenez plus tard.",
    essentiel: true,
    traceurs: [
      {
        nom: "lm.anon_id",
        cle: "lm.anon_id",
        correspondance: "exacte",
        support: "Stockage local",
        finalite:
          "Identifiant aléatoire, sans lien avec votre identité : il permet à l'assistant de retrouver le fil de vos échanges lorsque vous n'avez pas de compte. Deux visiteurs ne partagent ainsi pas la même conversation.",
        duree: "Jusqu'à l'effacement des données du navigateur",
      },
      {
        nom: "ledgermind_guidance_session",
        cle: "ledgermind_guidance_session",
        correspondance: "exacte",
        support: "Stockage local",
        finalite:
          "Rattache la conversation de mise en route à votre parcours, pour le reprendre là où vous l'aviez laissé.",
        duree: "Jusqu'à la réinitialisation du parcours ou l'effacement du navigateur",
      },
      {
        nom: "ledgermind_session_id",
        cle: "ledgermind_session_id",
        correspondance: "exacte",
        support: "Stockage de session",
        finalite: "Relie entre elles les questions posées à l'assistant pendant votre visite.",
        duree: "Fermeture de l'onglet",
      },
      {
        nom: "ledgermind_diagnostic_result",
        cle: "ledgermind_diagnostic_result",
        correspondance: "exacte",
        support: "Stockage de session",
        finalite:
          "Transporte le résultat de votre diagnostic entre l'écran de questions et l'écran de résultat.",
        duree: "Fermeture de l'onglet",
      },
      {
        nom: "ledgermind_scenarios_brouillon",
        cle: "ledgermind_scenarios_brouillon",
        correspondance: "exacte",
        support: "Stockage de session",
        finalite:
          "Conserve une simulation en cours de saisie pour ne pas la perdre en changeant d'écran.",
        duree: "Fermeture de l'onglet",
      },
    ],
  },
  {
    id: "confort",
    titre: "Confort d'affichage",
    intro: "Ils mémorisent vos préférences d'interface. Aucune donnée fiscale n'y figure.",
    essentiel: false,
    traceurs: [
      {
        nom: "lm.theme",
        cle: "lm.theme",
        correspondance: "exacte",
        support: "Stockage local",
        finalite:
          "Retient votre choix d'affichage clair ou sombre, appliqué avant le premier rendu pour éviter un changement brutal de luminosité.",
        duree: "Jusqu'à l'effacement des données du navigateur",
      },
      {
        nom: "sidebar_state",
        cle: "sidebar_state",
        correspondance: "exacte",
        support: "Cookie",
        finalite: "Retient si le volet de navigation est ouvert ou replié.",
        duree: "7 jours",
      },
      {
        nom: "lm.veille.nouveaux",
        cle: "lm.veille.nouveaux",
        correspondance: "exacte",
        support: "Stockage de session",
        finalite:
          "Évite de vous signaler comme « nouvelles » des informations de veille réglementaire déjà consultées.",
        duree: "Fermeture de l'onglet",
      },
    ],
  },
];

export const TOUS_TRACEURS: Traceur[] = GROUPES.flatMap((g) => g.traceurs);

/* ------------------------------------------------------------------ Inspection de l'appareil */

/** Une clé réellement présente sur l'appareil, rattachée à son entrée de catalogue. */
export type Presence = {
  /** Clé telle qu'elle existe sur l'appareil (préfixe déjà résolu). */
  cle: string;
  support: Support;
  /** Poids approximatif de la valeur, en octets. */
  octets: number;
};

export type Etat = {
  /** Clés répertoriées, indexées par `Traceur.nom`. Un traceur peut couvrir plusieurs clés
   *  (`lm.plan.<identifiant>` : une par compte utilisé sur ce navigateur). */
  parTraceur: Map<string, Presence[]>;
  /** Clés trouvées mais absentes du catalogue — filet contre une dérive silencieuse. */
  nonRepertoriees: Presence[];
  total: number;
};

function lireStockage(zone: "local" | "session"): Array<[string, string]> {
  if (typeof window === "undefined") return [];
  try {
    const s = zone === "local" ? window.localStorage : window.sessionStorage;
    const entrees: Array<[string, string]> = [];
    for (let i = 0; i < s.length; i += 1) {
      const cle = s.key(i);
      if (cle === null) continue;
      entrees.push([cle, s.getItem(cle) ?? ""]);
    }
    return entrees;
  } catch {
    // Stockage refusé par le navigateur : il n'y a alors rien à inventorier.
    return [];
  }
}

function lireCookies(): Array<[string, string]> {
  if (typeof document === "undefined") return [];
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const sep = part.indexOf("=");
      return sep === -1
        ? ([part, ""] as [string, string])
        : ([part.slice(0, sep), part.slice(sep + 1)] as [string, string]);
    });
}

/**
 * Rattache une clé au traceur qui la décrit.
 *
 * Les correspondances exactes priment sur les préfixes : sans cette règle, `lm.plan.pending`
 * serait absorbé par `lm.plan.<identifiant>` et disparaîtrait de l'inventaire alors qu'il a une
 * finalité et une durée distinctes.
 */
function trouverTraceur(cle: string, support: Support): Traceur | null {
  const candidats = TOUS_TRACEURS.filter((t) => t.support === support);
  const exact = candidats.find((t) => t.correspondance === "exacte" && t.cle === cle);
  if (exact) return exact;
  return candidats.find((t) => t.correspondance === "prefixe" && cle.startsWith(t.cle)) ?? null;
}

/** Inventaire de ce qui se trouve réellement sur cet appareil. Client uniquement. */
export function lireEtat(): Etat {
  const parTraceur = new Map<string, Presence[]>();
  const nonRepertoriees: Presence[] = [];
  let total = 0;

  const sources: Array<[Support, Array<[string, string]>]> = [
    ["Stockage local", lireStockage("local")],
    ["Stockage de session", lireStockage("session")],
    ["Cookie", lireCookies()],
  ];

  for (const [support, entrees] of sources) {
    for (const [cle, valeur] of entrees) {
      const presence: Presence = { cle, support, octets: cle.length + valeur.length };
      total += 1;
      const traceur = trouverTraceur(cle, support);
      if (!traceur) {
        nonRepertoriees.push(presence);
        continue;
      }
      const liste = parTraceur.get(traceur.nom) ?? [];
      liste.push(presence);
      parTraceur.set(traceur.nom, liste);
    }
  }

  return { parTraceur, nonRepertoriees, total };
}

/* -------------------------------------------------------------------------------- Effacement */

function supprimer(presence: Presence) {
  try {
    if (presence.support === "Stockage local") window.localStorage.removeItem(presence.cle);
    else if (presence.support === "Stockage de session")
      window.sessionStorage.removeItem(presence.cle);
    // Un cookie ne s'efface pas : il s'expire. Le `path` doit être celui du dépôt (voir
    // `components/ui/sidebar.tsx`), sinon le navigateur en supprime un autre — ou aucun.
    else document.cookie = `${presence.cle}=; path=/; max-age=0`;
  } catch {
    // Stockage indisponible : rien à effacer de toute façon.
  }
}

export type Portee = "confort" | "tout";

/**
 * Efface les traceurs de la portée demandée et renvoie le nombre de clés supprimées.
 *
 * `confort` ne touche qu'aux préférences d'affichage : la session reste ouverte, le parcours
 * intact. `tout` retire tout ce que cette page peut atteindre — l'appelant doit donc prévenir
 * avant, et renvoyer l'utilisateur vers une page publique après.
 *
 * ATTENTION — cette fonction **ne peut pas révoquer la session**. Le cookie qui la porte est
 * `httpOnly` : une écriture dans `document.cookie` reste sans effet sur lui, et échouerait en
 * silence. Seul le serveur peut le retirer. Un écran qui annonce une déconnexion doit donc
 * appeler `revoquerSession()` (`lib/auth`) en plus d'appeler cette fonction, sinon il affirme
 * quelque chose de faux : l'interface repasse en visiteur alors que la session reste ouverte.
 */
export function effacer(portee: Portee): number {
  if (typeof window === "undefined") return 0;

  const etat = lireEtat();
  const nomsConfort = new Set(
    GROUPES.filter((g) => !g.essentiel).flatMap((g) => g.traceurs.map((t) => t.nom)),
  );

  let supprimes = 0;
  for (const [nom, presences] of etat.parTraceur) {
    if (portee === "confort" && !nomsConfort.has(nom)) continue;
    for (const presence of presences) {
      supprimer(presence);
      supprimes += 1;
    }
  }

  // Les clés non répertoriées partent avec le grand ménage : promettre « tout effacer » et
  // laisser derrière soi ce qu'on n'avait pas prévu serait exactement le manquement à éviter.
  if (portee === "tout") {
    for (const presence of etat.nonRepertoriees) {
      supprimer(presence);
      supprimes += 1;
    }
  }

  // Thème et formule sont lus via des abonnements : sans ces événements, l'interface continuerait
  // d'afficher un état qui n'existe plus en stockage.
  window.dispatchEvent(new CustomEvent("lm.theme.change"));
  window.dispatchEvent(new CustomEvent("lm.plan.change"));

  return supprimes;
}
