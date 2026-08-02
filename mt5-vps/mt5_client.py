"""
mt5_client.py — Connexion au terminal MT5 local, avec reconnexion automatique.

Toutes les autres fonctions du VPS appellent `ensure_mt5()` et utilisent la
valeur qu'elle retourne (jamais une variable importée directement) : c'est ce
qui permet la reconnexion transparente si MT5 se déconnecte entre deux tours
de boucle.
"""

mt5 = None


def _init_mt5():
    global mt5
    try:
        import MetaTrader5 as _mt5
    except ImportError:
        print("[MT5] Package absent — pip install MetaTrader5")
        return None
    if not _mt5.initialize():
        print(f"[MT5] initialize() échoué : {_mt5.last_error()}")
        return None
    ai = _mt5.account_info()
    if ai is None:
        print("[MT5] account_info() None.")
        return None
    print(f"[MT5] Connecté — login={ai.login} server={ai.server} balance={ai.balance:.2f}")
    return _mt5


def ensure_mt5():
    global mt5
    if mt5 is not None:
        try:
            if mt5.account_info() is not None:
                return mt5
        except Exception:
            pass
    mt5 = _init_mt5()
    return mt5
