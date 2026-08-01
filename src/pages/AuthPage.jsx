import { useState } from 'react'
import { useAuth } from '../context/useAuth'
import { api } from '../lib/api'
import { SAFE_AREA_SCREEN, CARD, FIELD_INPUT } from '../lib/layout'

export function AuthPage() {
  const { login, signup } = useAuth()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setInfo('')
    setSubmitting(true)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else if (mode === 'signup') {
        await signup(email, password)
      } else {
        const result = await api.forgotPassword(email)
        setInfo(result.message)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function switchMode(nextMode) {
    setMode(nextMode)
    setError('')
    setInfo('')
  }

  const title = { login: 'Content de te revoir', signup: 'Créer un compte', forgot: 'Mot de passe oublié' }[mode]
  const eyebrow = { login: 'Connexion', signup: 'Inscription', forgot: 'Réinitialisation' }[mode]

  return (
    <main className={SAFE_AREA_SCREEN}>
      <form className={`flex flex-col gap-4 ${CARD}`} onSubmit={handleSubmit}>
        <p className="text-xs font-bold tracking-[0.24em] text-indigo-400 uppercase">{eyebrow}</p>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">{title}</h1>

        <label className="flex flex-col gap-1.5 text-sm text-slate-400">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={FIELD_INPUT}
          />
        </label>

        {mode !== 'forgot' && (
          <label className="flex flex-col gap-1.5 text-sm text-slate-400">
            <span>Mot de passe</span>
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={FIELD_INPUT}
            />
          </label>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
        {info && <p className="text-sm text-green-400">{info}</p>}

        <button
          className="min-h-12 rounded-full bg-indigo-600 font-semibold text-white disabled:opacity-60"
          type="submit"
          disabled={submitting}
        >
          {submitting
            ? 'Patiente...'
            : { login: 'Se connecter', signup: "S'inscrire", forgot: 'Envoyer le lien' }[mode]}
        </button>

        {mode === 'login' && (
          <button
            type="button"
            className="min-h-11 text-center text-sm font-medium text-indigo-400"
            onClick={() => switchMode('forgot')}
          >
            Mot de passe oublié ?
          </button>
        )}

        <button
          type="button"
          className="min-h-11 text-center text-sm font-medium text-indigo-400"
          onClick={() => switchMode(mode === 'signup' ? 'login' : mode === 'forgot' ? 'login' : 'signup')}
        >
          {mode === 'signup'
            ? 'Déjà un compte ? Se connecter'
            : mode === 'forgot'
              ? 'Retour à la connexion'
              : "Pas encore de compte ? S'inscrire"}
        </button>
      </form>
    </main>
  )
}
