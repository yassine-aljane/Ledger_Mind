"""Tous les prompts LLM, centralisés et rédigés en français.

Chaque fonction renvoie un couple (system, user). La sortie utilisateur finale
est systématiquement en français (FR-14).
"""
from __future__ import annotations

from typing import Any, Dict, List

from .config import EXPENSE_CATEGORIES

_CATS = ", ".join(EXPENSE_CATEGORIES)

# Libellés français des champs, partagés par la question HITL et les suggestions.
_FIELD_LABELS = {
    "invoice_number": "le numéro de la facture",
    "issuer_name": "le nom de l'émetteur (fournisseur)",
    "issuer_tax_id": "le matricule fiscal / SIREN de l'émetteur",
    "issue_date": "la date d'émission (JJ/MM/AAAA)",
    "total_ttc": "le montant total TTC",
    "subtotal_ht": "le sous-total HT",
    "vat_amount": "le montant de TVA",
    "currency": "la devise",
    "client_name": "le nom du client",
}

# Libellés des champs d'un virement (public : utilisé par les nœuds virement).
VIREMENT_FIELD_LABELS = {
    "amount": "le montant du virement",
    "execution_date": "la date d'exécution (JJ/MM/AAAA)",
    "value_date": "la date de valeur (JJ/MM/AAAA)",
    "transfer_reference": "la référence du virement",
    "sender_name": "le nom du donneur d'ordre (émetteur)",
    "sender_iban": "l'IBAN de l'émetteur",
    "beneficiary_name": "le nom du bénéficiaire",
    "beneficiary_iban": "l'IBAN du bénéficiaire",
    "motif": "le motif / libellé du virement",
}

CONTRAT_FIELD_LABELS = {
    "contract_type": (
        "la nature du contrat (travail, prestation, partenariat, sponsoring, "
        "bail, confidentialité, autre)"
    ),
    "title": "l'intitulé du contrat",
    "reference": "la référence / le numéro du contrat",
    "signature_date": "la date de signature (JJ/MM/AAAA)",
    "start_date": "la date de prise d'effet (JJ/MM/AAAA)",
    "end_date": "la date de fin (JJ/MM/AAAA)",
    "duration_months": "la durée en mois",
    "amount": "le montant de la contrepartie (rémunération, forfait, budget)",
    "payment_schedule": "la périodicité de versement",
    "notice_period_days": "le préavis de résiliation, en jours",
    "jurisdiction": "le droit applicable ou la juridiction compétente",
}


# --- Lecture manuscrite ------------------------------------------------------
# Bloc commun aux trois extractions. Un document peut être imprimé, écrit à la
# main, ou imprimé avec des champs remplis à la main (bon de commande, reçu à
# souche, contrat type). Sur du manuscrit, le risque n'est pas de ne rien lire
# — la reconnaissance rend presque toujours quelque chose — mais de lire FAUX
# en silence. On demande donc au modèle de déclarer ses doutes plutôt que de
# les masquer : les champs signalés partent en confirmation humaine.
HANDWRITING_RULES = (
    "LECTURE MANUSCRITE :\n"
    "- Le document peut être imprimé, manuscrit, ou imprimé avec des champs "
    "remplis à la main. Traite les trois.\n"
    "- Sur du manuscrit, méfie-toi des confusions courantes : 1/7, 0/6, 3/8, "
    "5/S, 2/Z, virgule et point décimaux, séparateurs de milliers.\n"
    "- Quand une valeur est lisible SANS AMBIGUÏTÉ, donne-la normalement.\n"
    "- Quand tu lis une valeur mais qu'un doute sérieux subsiste, donne quand "
    "même ta meilleure lecture ET inscris le nom du champ dans `_uncertain` : "
    "elle sera soumise à confirmation humaine. Ne la mets pas à null.\n"
    "- Quand tu ne lis RIEN d'exploitable, mets null (n'invente jamais).\n"
    "- `_uncertain` ne doit contenir que des champs réellement douteux : tout "
    "signaler reviendrait à ne rien signaler."
)

HANDWRITING_SCHEMA = (
    '  "_writing_mode": "imprime"|"manuscrit"|"mixte",  // mode d\'écriture constaté\n'
    '  "_uncertain": [string]                           // champs lus mais douteux\n'
)

_MODE_LABELS = {
    "manuscrit": "document entièrement manuscrit",
    "mixte": "document imprimé dont certains champs sont remplis à la main",
}


def lecture_note(writing_mode: str = None, confirmed: List[str] = None) -> str:
    """Contexte de lecture transmis aux analyses rédigées.

    Une pièce manuscrite mérite d'être signalée comme telle dans l'analyse : le
    lecteur saura que les montants proviennent d'une transcription, non d'un
    fichier structuré.
    """
    if writing_mode not in _MODE_LABELS:
        return ""
    note = f"\nLECTURE : {_MODE_LABELS[writing_mode]}."
    if confirmed:
        note += (
            " Les champs suivants ont été confirmés ou corrigés par l'utilisateur "
            f"après lecture douteuse : {', '.join(confirmed)}."
        )
    note += (
        " Mentionne brièvement, en fin d'analyse, que les valeurs proviennent "
        "d'une lecture manuscrite et méritent une relecture."
    )
    return note


# --- Détection de langue -----------------------------------------------------
def detect_language(ocr_text: str):
    system = (
        "Tu es un détecteur de langue. Tu réponds STRICTEMENT en JSON "
        '{"language": "<code ISO 639-1>"} et rien d\'autre.'
    )
    user = f"Quelle est la langue principale de ce texte de facture ?\n\n{ocr_text[:4000]}"
    return system, user


# --- Détection du type de document ------------------------------------------
def detect_document_type(ocr_text: str):
    system = (
        "Tu détermines la NATURE d'un document français à partir de son texte "
        "OCR. Trois types possibles :\n"
        '- "facture" : une facture (invoice) — numéro de facture, émetteur/client, '
        "lignes de prestation ou de produits, montants HT/TVA/TTC.\n"
        '- "virement" : un justificatif de VIREMENT BANCAIRE (avis d\'opération, '
        "preuve/ordre de virement, confirmation SEPA) — donneur d'ordre, "
        "bénéficiaire, IBAN, montant transféré, motif/communication.\n"
        '- "contrat" : un CONTRAT ou une convention signée entre des parties — '
        "contrat de travail, de prestation, de partenariat, de sponsoring, bail, "
        "accord de confidentialité. Signes distinctifs : des ARTICLES ou clauses "
        "numérotés, l'identification de parties (« entre les soussignés »), une "
        "durée ou une prise d'effet, des obligations réciproques, des signatures.\n"
        '- "autre" : TOUT LE RESTE — le document ne relève d\'aucun des trois '
        "types ci-dessus (pièce d'identité, relevé de compte, bulletin de paie, "
        "attestation, courrier, devis non signé, photo sans rapport, page "
        "illisible…).\n"
        "RÈGLE DE DÉPARTAGE : un document qui ENGAGE des parties dans la durée "
        "est un contrat, même s'il mentionne des montants. Une facture constate "
        "une créance ponctuelle ; un virement constate un mouvement d'argent "
        "déjà exécuté.\n"
        "N'ÉTIRE JAMAIS une catégorie pour faire entrer un document qui n'y "
        "appartient pas : en cas de doute réel, réponds \"autre\". Une "
        "classification forcée produirait une extraction fausse, ce qui est "
        "pire qu'un document écarté.\n"
        'Réponds STRICTEMENT en JSON : {"type": "facture" | "virement" | '
        '"contrat" | "autre", "nature": string|null}. Le champ "nature" n\'est '
        'rempli que pour le type "autre" : deux ou trois mots décrivant ce que '
        'le document semble être (ex. "bulletin de paie", "carte d\'identité").'
    )
    user = f"Texte OCR du document :\n\n{ocr_text[:4000]}"
    return system, user


# --- Extraction structurée d'un virement bancaire (France) ------------------
def extract_virement(ocr_text: str):
    system = (
        "Tu extrais les informations d'un JUSTIFICATIF DE VIREMENT BANCAIRE "
        "français. À partir du texte OCR, renvoie STRICTEMENT un objet JSON "
        "respectant ce schéma :\n"
        "{\n"
        '  "transfer_reference": string|null,   // référence / n° d\'opération\n'
        '  "execution_date": string|null,       // date d\'exécution (ISO YYYY-MM-DD)\n'
        '  "value_date": string|null,           // date de valeur (ISO) si présente\n'
        '  "amount": number|null,               // montant transféré\n'
        '  "currency": string|null,             // ex. EUR\n'
        '  "direction": string|null,            // "emis" ou "recu" selon le sens\n'
        '  "sender_name": string|null,          // donneur d\'ordre / émetteur\n'
        '  "sender_iban": string|null,\n'
        '  "beneficiary_name": string|null,     // bénéficiaire\n'
        '  "beneficiary_iban": string|null,\n'
        '  "beneficiary_bic": string|null,      // BIC / SWIFT\n'
        '  "bank_name": string|null,\n'
        '  "motif": string|null,                // motif / libellé / communication\n'
        '  "transfer_type": string|null,        // SEPA, instantané, international\n'
        + HANDWRITING_SCHEMA
        + "}\n"
        "RÈGLES IMPÉRATIVES :\n"
        "- Comprends le SENS de chaque valeur d'après le contexte, même sans "
        "libellé explicite.\n"
        "- IBAN : conserve-le SANS espaces, en majuscules (FR + 25 caractères).\n"
        "- Montants = nombres (pas de symbole). Si absent/illisible : null. "
        "N'INVENTE JAMAIS.\n"
        + HANDWRITING_RULES
    )
    user = f"Texte OCR du virement :\n\n{ocr_text}"
    return system, user


# --- Analyse rédigée d'un virement ------------------------------------------
def write_virement_analysis(ocr_text: str, transfer: Dict, incoherences: List[str] = None,
                            writing_mode: str = None, confirmed: List[str] = None):
    system = (
        "Tu es un assistant comptable pour micro-entrepreneurs français "
        "(créateurs de contenu). Rédige une COURTE ANALYSE en français de ce "
        "VIREMENT BANCAIRE — PAS un résumé. Précise s'il s'agit d'un virement "
        "REÇU (encaissement → chiffre d'affaires, base des cotisations URSSAF) "
        "ou ÉMIS (paiement d'une dépense), le montant, le bénéficiaire ou le "
        "donneur d'ordre, le motif, et ce à quoi il faut faire attention. "
        "3 à 5 phrases, ton professionnel et concret.\n"
        "- Si des INCOHÉRENCES sont fournies, signale-les explicitement (elles "
        "ont été calculées, ne les recalcule pas)."
    )
    faits = ""
    if incoherences:
        faits += "\nINCOHÉRENCES DÉTECTÉES : " + " ; ".join(incoherences)
    faits += lecture_note(writing_mode, confirmed)
    user = (
        f"Champs extraits : {transfer}{faits}\n\n"
        f"Texte du virement :\n{ocr_text[:6000]}"
    )
    return system, user


# --- Extraction structurée d'un contrat -------------------------------------
def extract_contrat(ocr_text: str):
    system = (
        "Tu extrais les informations d'un CONTRAT français (travail, prestation, "
        "partenariat, sponsoring, bail, confidentialité). À partir du texte OCR, "
        "renvoie STRICTEMENT un objet JSON respectant ce schéma :\n"
        "{\n"
        '  "contract_type": string|null,   // "travail"|"prestation"|"partenariat"'
        '|"sponsoring"|"bail"|"confidentialité"|"autre"\n'
        '  "title": string|null,           // intitulé exact du contrat\n'
        '  "reference": string|null,       // n° / référence du contrat\n'
        '  "parties": [                    // TOUS les signataires, dans l\'ordre\n'
        '    {"name": string|null, "role": string|null, "identifier": string|null}\n'
        "  ],\n"
        '  "signature_date": string|null,  // ISO YYYY-MM-DD\n'
        '  "start_date": string|null,      // prise d\'effet, ISO YYYY-MM-DD\n'
        '  "end_date": string|null,        // échéance, ISO YYYY-MM-DD ; null si indéterminée\n'
        '  "duration_months": number|null, // durée en mois si exprimée\n'
        '  "is_open_ended": boolean|null,  // true si durée INDÉTERMINÉE (CDI…)\n'
        '  "amount": number|null,          // contrepartie financière principale\n'
        '  "currency": string|null,        // ex. EUR\n'
        '  "payment_schedule": string|null,// mensuel, forfait, à la livraison…\n'
        '  "notice_period_days": number|null, // préavis de résiliation, en JOURS\n'
        '  "renewal": string|null,         // tacite reconduction, non renouvelable…\n'
        '  "jurisdiction": string|null,    // droit applicable / tribunal compétent\n'
        '  "obligations": [string],        // 3 à 6 engagements clés, une phrase chacun\n'
        + HANDWRITING_SCHEMA
        + "}\n"
        "RÈGLES IMPÉRATIVES :\n"
        "- `role` décrit la qualité de la partie telle que le contrat la nomme "
        "(employeur, salarié, prestataire, client, sponsor, bailleur…).\n"
        "- `amount` = la contrepartie PRINCIPALE et RÉCURRENTE si elle existe "
        "(salaire brut mensuel, forfait, budget), pas la somme de tous les "
        "montants cités.\n"
        "- Un préavis exprimé en mois se convertit en jours (1 mois = 30).\n"
        "- `is_open_ended` vaut true pour un CDI ou une durée indéterminée "
        "explicite ; dans ce cas `end_date` reste null.\n"
        "- `obligations` : reformule brièvement, ne recopie pas des articles "
        "entiers.\n"
        "- Tout champ absent ou illisible vaut null. N'INVENTE JAMAIS.\n"
        + HANDWRITING_RULES
    )
    user = f"Texte OCR du contrat :\n\n{ocr_text[:12000]}"
    return system, user


# --- Analyse rédigée d'un contrat -------------------------------------------
def write_contrat_analysis(ocr_text: str, contract: Dict, incoherences: List[str] = None,
                           writing_mode: str = None, confirmed: List[str] = None):
    system = (
        "Tu es un assistant juridique et comptable pour micro-entrepreneurs "
        "français (créateurs de contenu). Rédige une COURTE ANALYSE en français "
        "de ce CONTRAT — PAS un résumé article par article. Dis ce que le "
        "contrat engage concrètement : qui s'engage envers qui, sur quoi, "
        "pendant combien de temps, pour quelle contrepartie, et ce qui mérite "
        "vigilance (durée, préavis, reconduction, exclusivité, cession de "
        "droits, pénalités). Précise les incidences pratiques : un revenu de "
        "sponsoring ou de partenariat entre dans le chiffre d'affaires et "
        "supporte des cotisations ; un contrat de travail relève d'un autre "
        "régime. 4 à 6 phrases, ton professionnel et concret.\n"
        "- Si des INCOHÉRENCES sont fournies, signale-les explicitement (elles "
        "ont été calculées, ne les recalcule pas).\n"
        "- Tu n'es pas avocat : n'affirme jamais qu'une clause est légale ou "
        "illégale ; invite à faire vérifier ce qui est engageant."
    )
    faits = ""
    if incoherences:
        faits += "\nINCOHÉRENCES DÉTECTÉES : " + " ; ".join(incoherences)
    faits += lecture_note(writing_mode, confirmed)
    user = (
        f"Champs extraits : {contract}{faits}\n\n"
        f"Texte du contrat :\n{ocr_text[:8000]}"
    )
    return system, user


# --- Traduction vers le français --------------------------------------------
def translate_to_fr(ocr_text: str):
    system = (
        "Tu es un traducteur professionnel. Traduis fidèlement en français le "
        "texte de facture fourni, en conservant les montants, dates, numéros et "
        "la mise en page (lignes, tableaux) à l'identique. Ne commente pas, "
        "ne résume pas : renvoie uniquement la traduction."
    )
    user = ocr_text
    return system, user


# --- Extraction structurée ---------------------------------------------------
def extract_fields(ocr_text: str):
    system = (
        "Tu es un extracteur d'informations de factures. À partir du texte OCR, "
        "tu renvoies STRICTEMENT un objet JSON respectant ce schéma :\n"
        "{\n"
        '  "invoice_number": string|null,\n'
        '  "issuer_name": string|null,\n'
        '  "issuer_tax_id": string|null,\n'
        '  "client_name": string|null,\n'
        '  "issue_date": string|null,   // format ISO YYYY-MM-DD si possible\n'
        '  "line_items": [ {"description": string|null, "quantity": number|null, '
        '"unit_price": number|null, "total": number|null} ],\n'
        '  "subtotal_ht": number|null,\n'
        '  "vat_amount": number|null,\n'
        '  "total_ttc": number|null,\n'
        '  "currency": string|null,\n'
        '  "paid": true|false|null,          // la facture est-elle indiquée réglée/acquittée/payée ?\n'
        '  "due_date": string|null,          // date d\'échéance de paiement si indiquée (ISO YYYY-MM-DD)\n'
        '  "payment_terms_days": number|null, // délai de paiement en jours si mentionné (« à 30 jours » -> 30)\n'
        + HANDWRITING_SCHEMA
        + "}\n"
        "RÈGLES IMPÉRATIVES :\n"
        "- Comprends le SENS de chaque valeur d'après le contexte et la mise en "
        "page, même sans libellé explicite (ex. reconnais 12/02/2026 comme la "
        "date d'émission sans que le mot « date » apparaisse).\n"
        "- Si une valeur est absente ou illisible : mets null. N'INVENTE JAMAIS.\n"
        "- Les montants sont des nombres (pas de symbole monétaire).\n"
        "- paid : true seulement si la facture porte une mention claire (payée, "
        "acquittée, réglée, « payment received ») ; sinon false ou null.\n"
        + HANDWRITING_RULES
    )
    user = f"Texte OCR de la facture :\n\n{ocr_text}"
    return system, user


# --- Question de champ manquant (HITL) --------------------------------------
def ask_missing_field(field: str, invoice: Dict, labels: Dict = None) -> str:
    """Formule, en français, la question posée à l'utilisateur pour un champ."""
    libelle = (labels or _FIELD_LABELS).get(field, field)
    return (
        f"Je n'ai pas pu lire {libelle} sur le document. "
        f"Approuvez une proposition ou saisissez la valeur "
        f"(répondez « passer » pour l'ignorer)."
    )


def confirm_uncertain_field(field: str, value: Any, labels: Dict = None) -> str:
    """Question de CONFIRMATION d'une valeur lue mais douteuse (manuscrit).

    Différente de `ask_missing_field` : ici une valeur existe. La formulation
    doit exposer ce qui a été lu, pour que l'utilisateur corrige d'un coup
    d'œil au lieu de ressaisir à l'aveugle.
    """
    libelle = (labels or _FIELD_LABELS).get(field, field)
    return (
        f"J'ai lu {libelle} : « {value} », mais l'écriture manuscrite laisse un "
        f"doute. Confirmez cette valeur ou corrigez-la "
        f"(répondez « passer » pour la conserver telle quelle)."
    )


# --- Suggestions de valeurs pour champs manquants (HITL assisté) -------------
def suggest_field_values(fields: List[str], ocr_text: str, invoice: Dict, labels: Dict = None):
    """Demande au LLM des valeurs CANDIDATES lues dans le document, par champ.

    Contrairement à l'extraction (qui met `null` en cas de doute), ici on cherche
    à SURFACER des candidats plausibles que l'utilisateur validera (HITL). Rien
    n'est retenu sans approbation humaine ; si le texte n'offre rien, on renvoie
    une liste vide pour le champ.
    """
    lbl = labels or _FIELD_LABELS
    demandes = "; ".join(f'"{f}" = {lbl.get(f, f)}' for f in fields)
    system = (
        "Tu aides à compléter une facture dont certains champs n'ont pas pu être "
        "extraits avec certitude. Pour CHAQUE champ demandé, propose de 0 à 3 "
        "valeurs CANDIDATES effectivement présentes ou déductibles du texte OCR. "
        "Montants en nombres (sans symbole), dates au format JJ/MM/AAAA. "
        "NE DEVINE PAS au hasard : si rien de plausible n'apparaît, renvoie une "
        "liste vide pour ce champ. Classe les candidats du plus au moins probable.\n"
        'Réponds STRICTEMENT en JSON, une clé par champ demandé : '
        '{"<champ>": ["candidat1", "candidat2"], ...}.'
    )
    user = (
        f"Champs à compléter : {demandes}\n"
        f"Déjà extrait (pour contexte) : {invoice}\n\n"
        f"Texte OCR de la facture :\n{ocr_text[:6000]}"
    )
    return system, user


# --- Analyse rédigée (une analyse, pas un résumé) ----------------------------
def write_analysis(ocr_text: str, invoice: Dict, payment_note: str = None,
                   incoherences: List[str] = None, writing_mode: str = None,
                   confirmed: List[str] = None):
    system = (
        "Tu es un assistant comptable pour micro-entrepreneurs français "
        "(créateurs de contenu). Rédige une COURTE ANALYSE en français de cette "
        "facture — PAS un résumé. Ne répète pas la liste des champs : explique "
        "ce que cette dépense signifie pour l'activité, ce qui est notable "
        "(montant, nature, TVA, régularité), et ce à quoi il faut faire "
        "attention. 3 à 5 phrases, ton professionnel et concret.\n"
        "- Si une NOTE DE PAIEMENT est fournie, reprends-la telle quelle "
        "(garde la date exacte et le nombre de jours) dans l'analyse.\n"
        "- Si des INCOHÉRENCES sont fournies, signale-les explicitement comme "
        "des points de vigilance (elles ont été calculées, ne les recalcule pas)."
    )
    faits = ""
    if payment_note:
        faits += f"\nNOTE DE PAIEMENT (à reprendre telle quelle) : {payment_note}"
    if incoherences:
        faits += "\nINCOHÉRENCES DÉTECTÉES : " + " ; ".join(incoherences)
    faits += lecture_note(writing_mode, confirmed)
    user = (
        f"Champs extraits : {invoice}{faits}\n\n"
        f"Texte de la facture :\n{ocr_text[:6000]}"
    )
    return system, user


# --- Classification de la nature de dépense ---------------------------------
def classify_expense(ocr_text: str, invoice: Dict):
    system = (
        "Tu classes la nature d'une dépense de facture dans EXACTEMENT une "
        f"catégorie parmi : {_CATS}.\n"
        'Réponds STRICTEMENT en JSON : {"category": "<une des catégories>"}.'
    )
    user = f"Champs : {invoice}\n\nExtrait :\n{ocr_text[:3000]}"
    return system, user


# --- Q&A sur une facture déjà traitée (ancrage OCR + historique, sans RAG) ---
_QA_NATURE = {
    "facture": "une facture",
    "virement": "un virement bancaire",
    "contrat": "un contrat",
    "cadeau": "un cadeau reçu d'une marque (avantage en nature)",
}

# Consigne de MISE EN FORME de la réponse du chat.
#
# La réponse s'affiche dans un panneau latéral étroit (~340 px) : les titres markdown
# y sont hors d'échelle, et le modèle avait tendance à empiler « ### 1. », « ### 2. »
# au fil du texte, ce qui produisait un pavé illisible. On lui demande donc une
# structure plate — une phrase de réponse, puis des puces courtes — plutôt que des
# sections. Le gras reste autorisé : c'est ce qui fait ressortir les montants.
_QA_FORMAT = (
    "FORMAT DE RÉPONSE — à respecter strictement :\n"
    "- Commence par UNE phrase qui répond directement à la question, sans préambule.\n"
    "- Développe ensuite en puces courtes (« - »), une idée par puce, deux lignes maximum.\n"
    "- Mets en **gras** les montants, taux et échéances — rien d'autre.\n"
    "- N'utilise JAMAIS de titres markdown (#, ##, ###) ni de numérotation « 1. », « 2. ».\n"
    "- Pas d'emoji, pas de tableau, pas de bloc de code.\n"
    "- Termine par une puce « À retenir : … » seulement si elle ajoute quelque chose.\n"
    "- Reste sous 150 mots : ce panneau est étroit, une réponse longue n'est pas lue."
)


def qa_answer(
    ocr_text: str,
    structured: Dict,
    history: List[Dict[str, str]],
    question: str,
    *,
    document_type: str = "facture",
    analysis: str | None = None,
):
    """Prompt de Q&A sur une pièce déjà analysée.

    Le type est passé explicitement : formuler la consigne autour du « texte OCR de la
    facture » sur un cadeau conduisait le modèle à répondre « aucune information dans le
    texte OCR » alors que tous les champs utiles étaient là — un cadeau est une PHOTO
    d'objet, il n'a par construction aucun texte à lire.

    La synthèse rédigée est jointe aux champs : c'est elle qui porte le raisonnement
    fiscal (pourquoi la pièce est un revenu, ce qu'il faut en faire), et les questions
    des utilisateurs portent le plus souvent là-dessus.
    """
    nature = _QA_NATURE.get(document_type, "un document")
    system = (
        f"Tu réponds en français aux questions d'un utilisateur sur UNE pièce déjà "
        f"analysée — ici {nature}. Tu t'appuies UNIQUEMENT sur les éléments fournis "
        "ci-dessous : champs extraits, synthèse rédigée, texte de la pièce et historique "
        "de conversation. Si l'information n'y figure pas, dis-le clairement : n'invente "
        "rien, ne va chercher aucune source externe."
    )
    if document_type == "cadeau":
        system += (
            " Cette pièce est une PHOTO d'objet : elle ne contient aucun texte, et cette "
            "absence n'est PAS un manque d'information. Les champs extraits et la synthèse "
            "font foi — ne dis jamais que le texte du document est vide pour refuser de "
            "répondre. Rappelle au besoin qu'un cadeau reçu d'une marque en contrepartie "
            "d'une prestation est un revenu en nature, déclarable à sa valeur marchande."
        )

    system += "\n\n" + _QA_FORMAT

    hist = "\n".join(f"{m.get('role')}: {m.get('content')}" for m in history) or "(aucun)"

    blocs = [f"Champs extraits : {structured}"]
    if analysis:
        blocs.append(f"Synthèse rédigée lors de l'analyse :\n{analysis}")
    # Sur un cadeau, aucune section OCR : une rubrique vide invite le modèle à conclure
    # au manque d'information, ce qui est précisément le contraire de la réalité.
    if ocr_text:
        blocs.append(f"Texte du document :\n{ocr_text}")
    blocs.append(f"Historique de conversation :\n{hist}")
    blocs.append(f"Question de l'utilisateur : {question}")

    return system, "\n\n".join(blocs)
