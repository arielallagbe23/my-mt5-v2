#!/usr/bin/env python3
"""
test_notify.py — Script jetable pour vérifier que le pipeline de
notification (Planificateur de tâches -> Python -> push) fonctionne bout en
bout. Aucun effet de bord, à supprimer une fois le test validé.
"""

from notify import notify

ok = notify("Test alerte", "Si tu vois ça, la tâche planifiée fonctionne.")
if ok:
    print("[OK] Notification de test envoyée.")
else:
    print("[ECHEC] Notification NON envoyée (voir message [NOTIFY] ci-dessus).")
