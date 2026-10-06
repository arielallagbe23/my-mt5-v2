#!/usr/bin/env python3
"""
run_all.py — Lance tous les scripts à boucle infinie du VPS (mt5_status.py,
mirror_follower.py) comme sous-process, dans UNE SEULE fenêtre, avec leur
sortie préfixée ([MASTER]/[FOLLOWER]...) pour les distinguer — pratique pour
ne pas avoir à garder plusieurs fenêtres PowerShell séparées ouvertes.

Note : alerte_me_by_level.py n'est PLUS lancé ici — son rapport de situation
par position et sa notif de clôture tournent maintenant DANS mt5_status.py
(voir son import de check_position_level). Le relancer ici en plus
doublerait ces notifications.

Plusieurs suppléants (comptes miroir) : chaque entrée de PROCESSES a un 3e
élément optionnel, un dict de variables d'env propres à CE sous-process
(None = hérite l'environnement tel quel, comme MASTER et le premier
FOLLOWER). mirror_follower.py lit FOLLOWER_ID en priorité depuis l'env (voir
son commentaire) précisément pour que deux instances lancées ici avec des
env différents ne se marchent jamais dessus, même si elles partagent les
mêmes fichiers follower_*.txt locaux (ces fichiers ne servent alors que de
repli en lancement manuel, sans run_all.py).

Un 2e suppléant (3e compte) se configure comme tout le reste ici : un
fichier local follower2_terminal_path.txt (jamais commité, même régime que
master_terminal_path.txt/follower_terminal_path.txt — voir .gitignore).
Tant qu'il n'existe pas, FOLLOWER2 n'est tout simplement pas lancé — pas
besoin de retoucher ce fichier pour l'activer sur CE VPS.

Ctrl+C ici arrête proprement tous les sous-process (terminate, puis kill
après 10s si l'un d'eux ne répond pas).
"""

import os
import subprocess
import sys
import threading

_DIR = os.path.dirname(os.path.abspath(__file__))


def _read(name, default=None):
    path = os.path.join(_DIR, name)
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return f.read().strip()


PROCESSES = [
    ("MASTER", ["mt5_status.py"], None),
    ("FOLLOWER", ["mirror_follower.py"], None),
]

_follower2_terminal_path = _read("follower2_terminal_path.txt")
if _follower2_terminal_path:
    PROCESSES.append(("FOLLOWER2", ["mirror_follower.py"], {
        "FOLLOWER_ID": _read("follower2_id.txt", "account3"),
        "FOLLOWER_TERMINAL_PATH": _follower2_terminal_path,
        "FOLLOWER_DRY_RUN": _read("follower2_dry_run.txt", "true"),
        "FOLLOWER_MAGIC": _read("follower2_magic.txt", "234200"),
    }))


def _stream(name, proc):
    for line in proc.stdout:
        print(f"[{name}] {line}", end="")


def main():
    children = []
    try:
        for name, args, env_overrides in PROCESSES:
            env = {**os.environ, **env_overrides} if env_overrides else None
            proc = subprocess.Popen(
                [sys.executable, "-u", *args],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=env,
            )
            children.append(proc)
            threading.Thread(target=_stream, args=(name, proc), daemon=True).start()

        for proc in children:
            proc.wait()
    except KeyboardInterrupt:
        print("\n[run_all] Arrêt demandé, fermeture de tous les process...")
    finally:
        for proc in children:
            if proc.poll() is None:
                proc.terminate()
        for proc in children:
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    main()
