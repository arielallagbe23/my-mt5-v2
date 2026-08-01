import { useState } from 'react'
import { api } from '../lib/api'
import { SAFE_AREA_SCREEN, CARD, FIELD_INPUT } from '../lib/layout'

export function ResetPasswordPage({ token }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas')
      return
    }

    setSubmitting(true)
    try {
      await api.resetPassword(token, password)
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <main className={SAFE_AREA_SCREEN}>
        <div className={`flex flex-col gap-4 ${CARD}`}>
          <p className="text-xs font-bold tracking-[0.24em] text-indigo-400 uppercase">Réinitialisation</p>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">Mot de passe mis à jour</h1>
          <p className="text-sm text-green-400">Tu peux maintenant te connecter avec ton nouveau mot de passe.</p>
          <button
            className="min-h-12 rounded-full bg-indigo-600 font-semibold text-white"
            type="button"
            onClick={() => window.location.assign('/')}
          >
            Retour à la connexion
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className={SAFE_AREA_SCREEN}>
      <form className={`flex flex-col gap-4 ${CARD}`} onSubmit={handleSubmit}>
        <p className="text-xs font-bold tracking-[0.24em] text-indigo-400 uppercase">Réinitialisation</p>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Choisis un nouveau mot de passe</h1>

        <label className="flex flex-col gap-1.5 text-sm text-slate-400">
          <span>Nouveau mot de passe</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={FIELD_INPUT}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm text-slate-400">
          <span>Confirme le mot de passe</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={FIELD_INPUT}
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          className="min-h-12 rounded-full bg-indigo-600 font-semibold text-white disabled:opacity-60"
          type="submit"
          disabled={submitting}
        >
          {submitting ? 'Patiente...' : 'Réinitialiser le mot de passe'}
        </button>
      </form>
    </main>
  )
}
