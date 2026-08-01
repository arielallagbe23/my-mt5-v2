import { PAGE, PAGE_TITLE } from '../lib/layout'

export function HomePage() {
  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>Accueil</h1>
      <p className="text-slate-400">La calculatrice de taille de position arrive à la prochaine étape.</p>
    </div>
  )
}
