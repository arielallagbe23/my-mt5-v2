import { Router } from 'express'
import crypto from 'node:crypto'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const VPS_ID = process.env.MT5_VPS_ID ?? 'main'

// Chiffre le mot de passe MT5 avant de le poser dans Firestore (le VPS a la
// même clé — ACCOUNT_SWITCH_KEY — dans son fichier local
// account_switch_key.txt, jamais commité, même régime que cron_secret.txt).
// AES-256-GCM : IV (12) + tag d'authentification (16) + texte chiffré,
// concaténés puis encodés en base64 — le VPS les sépare dans le même ordre
// pour déchiffrer côté Python (cryptography.hazmat AESGCM, qui attend
// ciphertext+tag concaténés, d'où l'ordre choisi ici).
function encryptPassword(password) {
  const key = Buffer.from(process.env.ACCOUNT_SWITCH_KEY ?? '', 'base64')
  if (key.length !== 32) {
    throw new Error('ACCOUNT_SWITCH_KEY absente ou invalide côté serveur')
  }
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
}

router.post('/status/request', requireAuth, async (req, res) => {
  await db.collection('commands').doc('status_request').set({
    status: 'pending',
    ts: Date.now(),
  })
  res.status(202).json({ requested: true })
})

router.get('/status', requireAuth, async (req, res) => {
  const doc = await db.collection('vps_status').doc(VPS_ID).get()
  if (!doc.exists) {
    return res.status(503).json({ online: false, error: 'VPS non connecté' })
  }

  const data = doc.data()
  res.json({
    online: Boolean(data.online),
    equity: data.equity ?? null,
    margin: data.margin ?? null,
    freeMargin: data.free_margin ?? null,
    currency: data.currency ?? null,
    login: data.login ?? null,
    server: data.server ?? null,
    ts: data.ts ?? null,
    accounts: data.accounts ?? {},
  })
})

// Toute la collection vps_status (un doc par compte MT5 — "main", "account2",
// et tout futur suppléant), pour la page "Mes comptes". Renvoie l'account_size
// du login actuellement connecté sur chaque doc, déjà déplié — pas besoin de
// retoucher cette route à chaque compte ajouté. Fusionne aussi pseudo/
// riskMultiplier (account_settings/{vpsId}, propriété de l'app — jamais
// écrit par le VPS, contrairement à vps_status).
router.get('/all', requireAuth, async (req, res) => {
  const [statusSnapshot, settingsSnapshot] = await Promise.all([
    db.collection('vps_status').get(),
    db.collection('account_settings').get(),
  ])
  const settingsByVpsId = new Map(settingsSnapshot.docs.map((d) => [d.id, d.data()]))

  const result = {}
  for (const doc of statusSnapshot.docs) {
    const data = doc.data()
    const login = data.login ?? null
    const settings = settingsByVpsId.get(doc.id)
    result[doc.id] = {
      online: Boolean(data.online),
      login,
      equity: data.equity ?? null,
      currency: data.currency ?? null,
      server: data.server ?? null,
      ts: data.ts ?? null,
      accountSize: login != null ? ((data.accounts ?? {})[String(login)]?.account_size ?? null) : null,
      pseudo: settings?.pseudo ?? null,
      riskMultiplier: settings?.riskMultiplier ?? 1,
    }
  }
  res.json(result)
})

const MAX_RISK_MULTIPLIER = 5
const MAX_PSEUDO_LENGTH = 40

// Pseudo + multiplicateur de risque d'un compte — édité depuis la page "Mes
// comptes". Le multiplicateur n'affecte que le lot calculé du SUPPLÉANT
// concerné (voir compute_follower_lot dans mirror_follower.py) : x2 double
// le lot proratisé habituel, jamais le risque en % lui-même.
router.patch('/:vpsId/settings', requireAuth, async (req, res) => {
  const { pseudo, riskMultiplier } = req.body ?? {}

  if (pseudo != null && (typeof pseudo !== 'string' || pseudo.length > MAX_PSEUDO_LENGTH)) {
    return res.status(400).json({ error: `Pseudo invalide (max ${MAX_PSEUDO_LENGTH} caractères)` })
  }
  if (
    typeof riskMultiplier !== 'number' ||
    !Number.isFinite(riskMultiplier) ||
    riskMultiplier <= 0 ||
    riskMultiplier > MAX_RISK_MULTIPLIER
  ) {
    return res.status(400).json({ error: `Multiplicateur invalide (doit être entre 0 et ${MAX_RISK_MULTIPLIER})` })
  }

  const payload = { pseudo: pseudo?.trim() || null, riskMultiplier, updatedAt: Date.now() }
  await db.collection('account_settings').doc(req.params.vpsId).set(payload)
  res.json(payload)
})

// Bascule le compte principal sur un nouveau login/mot de passe/serveur —
// pour le cycle FTMO (nouveau compte tous les 3 mois) sans avoir à se
// connecter au VPS pour retaper les identifiants dans le terminal. Le mot
// de passe ne touche jamais le disque en clair : chiffré ici, le VPS le
// déchiffre en mémoire juste le temps de l'appel mt5.login(), puis efface
// le champ chiffré du document.
router.post('/switch', requireAuth, async (req, res) => {
  const { login, password, server } = req.body ?? {}

  if (!Number.isInteger(login) || login <= 0) {
    return res.status(400).json({ error: 'Login invalide' })
  }
  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'Mot de passe requis' })
  }
  if (typeof server !== 'string' || server.trim().length === 0) {
    return res.status(400).json({ error: 'Serveur requis (ex: FTMO-Server2)' })
  }

  let encryptedPassword
  try {
    encryptedPassword = encryptPassword(password)
  } catch {
    return res.status(500).json({ error: 'Chiffrement indisponible côté serveur' })
  }

  await db.collection('commands').doc('switch_account_request').set({
    status: 'pending',
    login,
    encryptedPassword,
    server: server.trim(),
    ts: Date.now(),
  })
  res.status(202).json({ requested: true })
})

router.get('/switch/result', requireAuth, async (req, res) => {
  const doc = await db.collection('switch_account_results').doc('main').get()
  if (!doc.exists) {
    return res.status(503).json({ error: 'Indisponible' })
  }
  res.json(doc.data())
})

export default router
