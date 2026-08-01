import { createHash, randomBytes } from 'node:crypto'
import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'
import { resolveOrigin } from '../lib/origin.js'
import { sendResetEmail } from '../mail.js'

const router = Router()
const SALT_ROUNDS = 12
const COOKIE_NAME = 'token'
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000

function setAuthCookie(res, userId) {
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '7d' })
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
  })
}

router.post('/signup', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email et mot de passe requis' })
  }

  const normalizedEmail = email.trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Email invalide' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' })
  }

  const usersRef = db.collection('users')
  const existing = await usersRef.where('email', '==', normalizedEmail).limit(1).get()
  if (!existing.empty) {
    return res.status(409).json({ error: 'Un compte existe déjà avec cet email' })
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)
  const docRef = await usersRef.add({
    email: normalizedEmail,
    passwordHash,
    createdAt: new Date().toISOString(),
  })

  setAuthCookie(res, docRef.id)
  res.status(201).json({ id: docRef.id, email: normalizedEmail, pseudo: null })
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email et mot de passe requis' })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const usersRef = db.collection('users')
  const snapshot = await usersRef.where('email', '==', normalizedEmail).limit(1).get()
  if (snapshot.empty) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' })
  }

  const userDoc = snapshot.docs[0]
  const { passwordHash, email: storedEmail, pseudo } = userDoc.data()
  const valid = await bcrypt.compare(password, passwordHash)
  if (!valid) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' })
  }

  setAuthCookie(res, userDoc.id)
  res.json({ id: userDoc.id, email: storedEmail, pseudo: pseudo ?? null })
})

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME)
  res.status(204).end()
})

router.post('/forgot-password', async (req, res) => {
  const { email, origin } = req.body ?? {}
  if (typeof email !== 'string') {
    return res.status(400).json({ error: 'Email requis' })
  }

  const genericResponse = {
    message: 'Si un compte existe avec cet email, un lien de réinitialisation vient d\'être envoyé.',
  }

  const normalizedEmail = email.trim().toLowerCase()
  const usersRef = db.collection('users')
  const snapshot = await usersRef.where('email', '==', normalizedEmail).limit(1).get()
  if (snapshot.empty) {
    return res.json(genericResponse)
  }

  const userDoc = snapshot.docs[0]
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')

  await db.collection('passwordResets').doc(tokenHash).set({
    userId: userDoc.id,
    expiresAt: Date.now() + RESET_TOKEN_TTL_MS,
    used: false,
  })

  const resetLink = `${resolveOrigin(origin)}/reset-password?token=${rawToken}`

  try {
    await sendResetEmail(normalizedEmail, resetLink)
  } catch (err) {
    console.error('[MAIL] Échec envoi reset :', err)
  }

  res.json(genericResponse)
})

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body ?? {}
  if (typeof token !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Requête invalide' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' })
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const resetRef = db.collection('passwordResets').doc(tokenHash)
  const resetDoc = await resetRef.get()

  if (!resetDoc.exists) {
    return res.status(400).json({ error: 'Lien invalide ou expiré' })
  }

  const resetData = resetDoc.data()
  if (resetData.used || resetData.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'Lien invalide ou expiré' })
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)
  await db.collection('users').doc(resetData.userId).update({ passwordHash })
  await resetRef.update({ used: true })

  res.status(204).end()
})

router.get('/me', requireAuth, async (req, res) => {
  const userDoc = await db.collection('users').doc(req.userId).get()
  if (!userDoc.exists) {
    return res.status(404).json({ error: 'Utilisateur introuvable' })
  }
  const data = userDoc.data()
  res.json({ id: userDoc.id, email: data.email, pseudo: data.pseudo ?? null })
})

router.patch('/profile', requireAuth, async (req, res) => {
  const { pseudo } = req.body ?? {}
  if (typeof pseudo !== 'string') {
    return res.status(400).json({ error: 'Pseudo invalide' })
  }
  const trimmed = pseudo.trim()
  if (trimmed.length > 30) {
    return res.status(400).json({ error: 'Le pseudo doit faire 30 caractères maximum' })
  }

  await db.collection('users').doc(req.userId).update({ pseudo: trimmed || null })
  const userDoc = await db.collection('users').doc(req.userId).get()
  const data = userDoc.data()
  res.json({ id: userDoc.id, email: data.email, pseudo: data.pseudo ?? null })
})

export default router
