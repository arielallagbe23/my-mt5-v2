"""
mt5_client.py — Connexion au terminal MT5 local, avec reconnexion automatique.

Toutes les autres fonctions du VPS appellent `ensure_mt5()` et utilisent la
valeur qu'elle retourne (jamais une variable importée directement) : c'est ce
qui permet la reconnexion transparente si MT5 se déconnecte entre deux tours
de boucle.

IMPORTANT (bug corrigé) : dès que PLUSIEURS terminaux MT5 tournent sur la
même machine (compte principal + suppléant), `MetaTrader5.initialize()`
SANS chemin explicite se connecte à un terminal de façon non déterministe —
pas forcément le bon. `set_default_path()` fixe, une bonne fois pour toutes
au démarrage d'un process, quel terminal ce process doit utiliser pour
TOUTES ses connexions (y compris les reconnexions après coupure) — les
modules qui appellent `ensure_mt5()` sans argument (la grande majorité)
héritent automatiquement de ce chemin, pas besoin de le repasser partout.
mirror_follower.py, qui tourne dans son propre process pour le compte
suppléant, continue de passer son `path` explicitement à chaque appel.
"""

mt5 = None
_default_path = None


def set_default_path(path):
    """À appeler une seule fois, tout au début d'un script, avant le premier
    ensure_mt5(). Sans ça, plusieurs terminaux qui tournent en même temps
    sur la VPS peuvent se faire confondre (voir bug ci-dessus)."""
    global _default_path
    _default_path = path


def _init_mt5(path=None):
    global mt5
    try:
        import MetaTrader5 as _mt5
    except ImportError:
        print("[MT5] Package absent — pip install MetaTrader5")
        return None
    target_path = path or _default_path
    ok = _mt5.initialize(path=target_path) if target_path else _mt5.initialize()
    if not ok:
        print(f"[MT5] initialize() échoué : {_mt5.last_error()}")
        return None
    ai = _mt5.account_info()
    if ai is None:
        print("[MT5] account_info() None.")
        return None
    print(f"[MT5] Connecté — login={ai.login} server={ai.server} balance={ai.balance:.2f}")
    return _mt5


def ensure_mt5(path=None):
    global mt5
    if mt5 is not None:
        try:
            if mt5.account_info() is not None:
                return mt5
        except Exception:
            pass
    mt5 = _init_mt5(path)
    return mt5
