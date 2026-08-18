#!/usr/bin/env python3
"""
run_all.py — Lance tous les scripts à boucle infinie du VPS (mt5_status.py,
mirror_follower.py, alerte_me_by_level.py) comme sous-process, dans UNE
SEULE fenêtre, avec leur sortie préfixée ([MASTER]/[FOLLOWER]/[LEVEL]) pour
les distinguer — pratique pour ne pas avoir à garder plusieurs fenêtres
PowerShell séparées ouvertes.

Ctrl+C ici arrête proprement tous les sous-process (terminate, puis kill
après 10s si l'un d'eux ne répond pas).
"""

import subprocess
import sys
import threading

PROCESSES = [
    ("MASTER", ["mt5_status.py"]),
    ("FOLLOWER", ["mirror_follower.py"]),
    ("LEVEL", ["alerte_me_by_level.py"]),
]


def _stream(name, proc):
    for line in proc.stdout:
        print(f"[{name}] {line}", end="")


def main():
    children = []
    try:
        for name, args in PROCESSES:
            proc = subprocess.Popen(
                [sys.executable, "-u", *args],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            children.append(proc)
            threading.Thread(target=_stream, args=(name, proc), daemon=True).start()

        for proc in children:
            proc.wait()
    except KeyboardInterrupt:
        print("\n[run_all] Arrêt demandé, fermeture des deux process...")
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
