/**
 * Transparence IA — article 50 du règlement (UE) 2024/1689.
 *
 * Source unique des textes de divulgation côté interface. Les mêmes chaînes existent dans
 * `backend/app/core/ai_act.py` pour les documents exportés ; elles sont volontairement
 * dupliquées plutôt que chargées depuis l'API, car une étiquette réglementaire ne doit pas
 * pouvoir disparaître parce qu'un appel réseau a échoué. `GET /api/ai-act/transparence`
 * reste la référence pour la page de transparence et pour l'audit.
 *
 * Ce que ce fichier NE fait pas : il ne produit que du marquage *visible*. Le marquage
 * lisible par machine (art. 50(2)) doit vivre dans le contenu lui-même — métadonnées de
 * document, signature C2PA — et non dans le DOM, qui disparaît au téléchargement. C'est le
 * backend qui le pose.
 */

/** Trois niveaux d'implication, calés sur les trois icônes du jeu européen. */
export type NiveauIA = "genere" | "modifie" | "assiste";

export type Marquage = {
  niveau: NiveauIA;
  /** Texte de l'étiquette. Court : il est lu d'un coup d'œil, pas parcouru. */
  libelleCourt: string;
  /** Détail du second niveau (panneau dépliable), pour qui veut comprendre. */
  libelleLong: string;
  /** Annoncé par les lecteurs d'écran à la place du pictogramme. */
  alt: string;
  /**
   * Badge officiel complet du jeu européen, texte anglais compris. À utiliser seul —
   * notamment pour l'incruster dans un fichier exporté, où notre libellé français ne
   * serait pas reconnu par un vérificateur automatique.
   */
  badgeOfficiel: string;
};

/**
 * Pictogramme seul (cercle « AI »), à apparier avec un libellé français.
 *
 * Les tests utilisateurs cités par la Commission montrent que l'icône est nettement mieux
 * comprise accompagnée d'un texte court. On garde donc le pictogramme officiel et on lui
 * adjoint notre libellé, plutôt que d'afficher le badge anglais complet à un public
 * francophone — ou, pire, de superposer les deux.
 */
export const PICTOGRAMME = "/ai-icons/ai-basic.svg";

export const MARQUAGES: Record<NiveauIA, Marquage> = {
  genere: {
    niveau: "genere",
    libelleCourt: "Généré par IA",
    libelleLong:
      "Ce contenu a été entièrement produit par une intelligence artificielle, sans " +
      "rédaction ni relecture humaine préalable. Vérifiez toute information avant de " +
      "l'utiliser pour une décision fiscale.",
    alt: "Contenu généré par intelligence artificielle",
    badgeOfficiel: "/ai-icons/ai-generated.svg",
  },
  modifie: {
    niveau: "modifie",
    libelleCourt: "Modifié par IA",
    libelleLong:
      "Ce contenu part d'éléments que vous avez fournis et qu'une intelligence " +
      "artificielle a composés, reformulés ou complétés.",
    alt: "Contenu modifié par intelligence artificielle",
    badgeOfficiel: "/ai-icons/ai-modified.svg",
  },
  assiste: {
    niveau: "assiste",
    libelleCourt: "Assisté par IA",
    libelleLong:
      "Ce contenu a été produit avec l'aide d'une intelligence artificielle, puis relu " +
      "sous responsabilité éditoriale humaine.",
    alt: "Contenu assisté par intelligence artificielle",
    badgeOfficiel: "/ai-icons/ai-basic.svg",
  },
};

/**
 * Divulgation de premier contact des agents conversationnels (art. 50(1)).
 *
 * Elle doit s'afficher AVANT le premier échange. Le guide écarte explicitement le report
 * de cette information dans des conditions générales : elle appartient à l'écran où la
 * conversation commence.
 */
export const DIVULGATION_CHAT =
  "Vous échangez avec une intelligence artificielle, pas avec un conseiller humain. " +
  "Ses réponses sont générées automatiquement et ne constituent pas un conseil fiscal.";

/** Divulgation courte, pour les surfaces de chat compactes (bulle flottante, tiroir). */
export const DIVULGATION_CHAT_COURTE =
  "Vous parlez à une IA. Réponses générées automatiquement, pas un conseil fiscal.";

/** Mention accompagnant les visuels de l'interface, tous produits par des modèles d'images. */
export const MENTION_VISUEL = "Visuel généré par IA";

export const REGLEMENT = "Règlement (UE) 2024/1689 — article 50";
