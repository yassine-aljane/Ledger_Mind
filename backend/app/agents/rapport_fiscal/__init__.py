"""Agent de rapport fiscal — CA encaissé, rapproché et auditable.

Architecture, en trois étages sans recouvrement :

    rapprochement.py   facture ↔ virement : QUOI a été encaissé, et grâce à quelle preuve
    orchestrateur.py   assemble le payload et APPELLE `app.agents.impots.tools`
    api/rapport_fiscal REST : deux modes, projection et déclaration

Aucune formule fiscale n'est écrite ici : le calcul appartient au moteur d'impôt. Cet agent
est un orchestrateur, pas un second moteur — deux implémentations finiraient par diverger.
"""

from .orchestrateur import generer
from .schemas import ContexteFiscalRapport, DemandeRapport, RapportFiscal

__all__ = ["generer", "ContexteFiscalRapport", "DemandeRapport", "RapportFiscal"]
