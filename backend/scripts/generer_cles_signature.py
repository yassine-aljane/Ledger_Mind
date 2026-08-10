"""Génère le couple clé privée / chaîne de certificats qui signe les contenus IA.

    python backend/scripts/generer_cles_signature.py            # génère si absent
    python backend/scripts/generer_cles_signature.py --force    # régénère (révoque de fait)
    python backend/scripts/generer_cles_signature.py --verifier  # contrôle seulement

Ce que ça produit dans `backend/certs/` :

    c2pa-ca.key      clé privée de l'autorité interne  (à conserver hors ligne)
    c2pa-ca.crt      certificat racine auto-signé      (à distribuer aux vérificateurs)
    c2pa-signer.key  clé privée de signature ES256     (lue par le backend)
    c2pa-signer.crt  certificat feuille                (émis par l'autorité ci-dessus)
    c2pa-chain.pem   feuille + racine concaténées      (format attendu par c2pa-python)

Pourquoi une autorité *et* une feuille plutôt qu'un simple auto-signé : C2PA valide une
chaîne, et refuse une feuille qui porte `CA:TRUE`. Un certificat unique auto-signé est donc
à la fois racine et feuille — configuration que le validateur rejette. Deux niveaux coûtent
une commande de plus et passent la validation.

La rotation est volontairement destructrice : `--force` écrase les fichiers. Les contenus
déjà signés restent vérifiables tant que l'ancienne racine est publiée ; archivez-la avant
de régénérer si des documents signés circulent encore.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

CERTS = Path(__file__).resolve().parents[1] / "certs"
CONFIG = CERTS / "c2pa-openssl.cnf"

CA_KEY = CERTS / "c2pa-ca.key"
CA_CRT = CERTS / "c2pa-ca.crt"
SIGNER_KEY = CERTS / "c2pa-signer.key"
SIGNER_CSR = CERTS / "c2pa-signer.csr"
SIGNER_CRT = CERTS / "c2pa-signer.crt"
CHAIN = CERTS / "c2pa-chain.pem"

# 10 ans pour la racine, 2 ans pour la feuille : la feuille tourne, la racine reste
# l'ancre de confiance des contenus déjà signés.
JOURS_CA = 3650
JOURS_FEUILLE = 730


def _openssl(*args: str) -> str:
    """Lance openssl et remonte son stderr tel quel en cas d'échec."""
    proc = subprocess.run(
        ["openssl", *args], capture_output=True, text=True, cwd=str(CERTS)
    )
    if proc.returncode != 0:
        raise SystemExit(
            f"openssl {' '.join(args)} a échoué ({proc.returncode}) :\n{proc.stderr.strip()}"
        )
    return proc.stdout


def _generer_cle_ec(destination: Path) -> None:
    """Clé EC P-256 au format PKCS#8 (« BEGIN PRIVATE KEY »).

    `genpkey` et non `ecparam -genkey` : ce dernier écrit du SEC1 (« BEGIN EC PRIVATE
    KEY »), que le SDK C2PA refuse — il lit exclusivement du PKCS#8 et échoue à la
    signature avec « unexpected PEM type label ». Les deux clés sont mathématiquement
    identiques ; seul l'encodage diffère, et lui seul décide si la signature aboutit.
    """
    _openssl(
        "genpkey",
        "-algorithm", "EC",
        "-pkeyopt", "ec_paramgen_curve:P-256",
        "-out", destination.name,
    )


def _verifier_openssl() -> None:
    try:
        version = _openssl("version").strip()
    except FileNotFoundError:
        raise SystemExit(
            "openssl introuvable dans le PATH.\n"
            "  Windows : il est fourni avec Git for Windows "
            "(C:\\Program Files\\Git\\usr\\bin\\openssl.exe)\n"
            "  macOS   : brew install openssl\n"
            "  Linux   : apt install openssl"
        )
    print(f"- {version}")


def generer(force: bool) -> None:
    CERTS.mkdir(parents=True, exist_ok=True)
    if not CONFIG.exists():
        raise SystemExit(f"Profil de certificat manquant : {CONFIG}")

    existants = [p for p in (CA_KEY, CA_CRT, SIGNER_KEY, SIGNER_CRT) if p.exists()]
    if existants and not force:
        print("Des clés existent déjà :")
        for p in existants:
            print(f"  - {p.name}")
        print("\nRien n'a été écrasé. Utilisez --force pour régénérer, "
              "--verifier pour contrôler la chaîne en place.")
        return

    _verifier_openssl()

    # --- Autorité interne -------------------------------------------------------------
    print("- Autorité : clé EC P-256")
    _generer_cle_ec(CA_KEY)
    print(f"- Autorité : certificat racine auto-signé ({JOURS_CA} j)")
    _openssl(
        "req", "-new", "-x509",
        "-key", CA_KEY.name,
        "-out", CA_CRT.name,
        "-days", str(JOURS_CA),
        "-config", CONFIG.name,
        "-extensions", "ext_ca",
    )

    # --- Feuille de signature ---------------------------------------------------------
    print("- Signataire : clé EC P-256 (ES256)")
    _generer_cle_ec(SIGNER_KEY)
    print("- Signataire : demande de certificat")
    # Pas de -reqexts ici : les extensions de la feuille (dont authorityKeyIdentifier, qui
    # référence l'émetteur) ne peuvent être posées qu'au moment de la signature, par -extfile.
    _openssl(
        "req", "-new",
        "-key", SIGNER_KEY.name,
        "-out", SIGNER_CSR.name,
        "-config", CONFIG.name,
        "-subj", "/C=FR/O=LedgerMind/OU=LedgerMind Content Provenance"
                 "/CN=LedgerMind AI Content Signer",
    )
    print(f"- Signataire : certificat signé par l'autorité ({JOURS_FEUILLE} j)")
    _openssl(
        "x509", "-req",
        "-in", SIGNER_CSR.name,
        "-CA", CA_CRT.name,
        "-CAkey", CA_KEY.name,
        "-CAcreateserial",
        "-out", SIGNER_CRT.name,
        "-days", str(JOURS_FEUILLE),
        "-sha256",
        "-extfile", CONFIG.name,
        "-extensions", "ext_leaf",
    )
    SIGNER_CSR.unlink(missing_ok=True)

    # --- Chaîne ------------------------------------------------------------------------
    # Ordre imposé : feuille d'abord, puis les émetteurs en remontant.
    CHAIN.write_text(
        SIGNER_CRT.read_text(encoding="utf-8") + CA_CRT.read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    print(f"- Chaîne écrite : {CHAIN.name}")

    _restreindre_permissions()
    verifier()

    print(
        "\nÀ faire ensuite :\n"
        f"  1. Renseignez dans backend/.env :\n"
        f"       C2PA_SIGNER_KEY={SIGNER_KEY}\n"
        f"       C2PA_SIGNER_CHAIN={CHAIN}\n"
        "  2. Ne versionnez JAMAIS *.key (déjà couvert par backend/certs/.gitignore).\n"
        "  3. En production, remplacez l'autorité interne par un certificat émis par une AC\n"
        "     reconnue — voir backend/certs/README.md."
    )


def _restreindre_permissions() -> None:
    """Retire l'accès aux clés privées à tout le monde sauf le propriétaire."""
    for cle in (CA_KEY, SIGNER_KEY):
        if not cle.exists():
            continue
        if sys.platform == "win32":
            # icacls : on casse l'héritage puis on ne rouvre que l'utilisateur courant.
            subprocess.run(["icacls", str(cle), "/inheritance:r"], capture_output=True)
            subprocess.run(
                ["icacls", str(cle), "/grant:r", f"{_utilisateur_windows()}:(R,W)"],
                capture_output=True,
            )
        else:
            cle.chmod(0o600)


def _utilisateur_windows() -> str:
    import os

    domaine = os.environ.get("USERDOMAIN", "")
    nom = os.environ.get("USERNAME", "")
    return f"{domaine}\\{nom}" if domaine else nom


def verifier() -> None:
    """Contrôle que la chaîne en place satisfait le profil C2PA."""
    manquants = [p.name for p in (CA_CRT, SIGNER_KEY, SIGNER_CRT, CHAIN) if not p.exists()]
    if manquants:
        raise SystemExit(
            "Chaîne incomplète, fichiers manquants : "
            + ", ".join(manquants)
            + "\nLancez le script sans --verifier pour la générer."
        )

    _verifier_openssl()
    print("\nVérification :")

    _openssl("verify", "-CAfile", CA_CRT.name, SIGNER_CRT.name)
    print("  [OK] la feuille est bien émise par l'autorité")

    texte = _openssl("x509", "-in", SIGNER_CRT.name, "-noout", "-text")
    controles = [
        ("courbe P-256 (ES256)", "prime256v1" in texte or "P-256" in texte),
        ("CA:FALSE sur la feuille", "CA:FALSE" in texte),
        ("keyUsage = Digital Signature", "Digital Signature" in texte),
        ("extendedKeyUsage = emailProtection", "E-mail Protection" in texte),
    ]
    for libelle, ok in controles:
        print(f"  {'[OK]' if ok else '[KO]'} {libelle}")
    if not all(ok for _, ok in controles):
        raise SystemExit(
            "Le certificat ne respecte pas le profil C2PA : régénérez avec --force."
        )

    # Encodage de la clé : le SDK C2PA n'accepte que PKCS#8. Contrôlé explicitement, car
    # une clé SEC1 passe toutes les autres vérifications et n'échoue qu'à la signature.
    entete = SIGNER_KEY.read_text(encoding="utf-8").splitlines()[0]
    pkcs8 = entete.strip() == "-----BEGIN PRIVATE KEY-----"
    print(f"  {'[OK]' if pkcs8 else '[KO]'} clé privée au format PKCS#8 (exigé par C2PA)")
    if not pkcs8:
        raise SystemExit(
            f"Clé au format {entete.strip()} : régénérez avec --force "
            "(ou convertissez : openssl pkcs8 -topk8 -nocrypt -in <clé> -out <clé>)."
        )

    # Cohérence clé privée ↔ certificat : deux empreintes de clé publique identiques.
    pub_cle = _openssl("pkey", "-in", SIGNER_KEY.name, "-pubout")
    pub_crt = _openssl("x509", "-in", SIGNER_CRT.name, "-noout", "-pubkey")
    print(
        "  [OK] la clé privée correspond au certificat"
        if pub_cle.strip() == pub_crt.strip()
        else "  [KO] la cle privee NE correspond PAS au certificat"
    )

    fin = _openssl("x509", "-in", SIGNER_CRT.name, "-noout", "-enddate").strip()
    print(f"  - expiration de la feuille : {fin.split('=', 1)[-1]}")


def main() -> None:
    parseur = argparse.ArgumentParser(
        description="Génère la chaîne de signature C2PA des contenus IA."
    )
    parseur.add_argument("--force", action="store_true", help="régénère et écrase l'existant")
    parseur.add_argument(
        "--verifier", action="store_true", help="ne génère rien, contrôle la chaîne en place"
    )
    args = parseur.parse_args()

    if args.verifier:
        verifier()
    else:
        generer(force=args.force)


if __name__ == "__main__":
    main()
