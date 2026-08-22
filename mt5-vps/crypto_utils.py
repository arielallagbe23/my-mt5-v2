"""
crypto_utils.py — Déchiffre ce que server/src/routes/account.js a chiffré
(AES-256-GCM) avec la clé partagée ACCOUNT_SWITCH_KEY. Utilisé pour le
changement de compte à distance (voir on_demand.py, _handle_switch_account_
request) : le mot de passe MT5 ne transite JAMAIS en clair par Firestore.

Format attendu (celui produit côté serveur) : base64(IV(12) + tag(16) +
ciphertext). cryptography.hazmat AESGCM attend ciphertext+tag concaténés en
un seul argument — d'où le découpage précis ci-dessous, dans le MÊME ordre
que côté Node (iv, puis tag, puis ciphertext).
"""

import base64

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from config import ACCOUNT_SWITCH_KEY


def decrypt_password(encoded):
    """Renvoie le mot de passe en clair, ou lève ValueError si la clé
    partagée est absente ou si le déchiffrement échoue (mauvaise clé,
    donnée corrompue/altérée — AESGCM vérifie l'intégrité, pas seulement
    la confidentialité)."""
    if not ACCOUNT_SWITCH_KEY:
        raise ValueError("ACCOUNT_SWITCH_KEY absente (account_switch_key.txt manquant)")

    key = base64.b64decode(ACCOUNT_SWITCH_KEY)
    raw = base64.b64decode(encoded)
    iv, tag, ciphertext = raw[:12], raw[12:28], raw[28:]

    aesgcm = AESGCM(key)
    try:
        plaintext = aesgcm.decrypt(iv, ciphertext + tag, None)
    except Exception as exc:
        raise ValueError(f"Déchiffrement échoué : {exc}") from exc
    return plaintext.decode("utf-8")
