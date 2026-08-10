import webpush from 'web-push'
import { db } from '../firebase.js'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
)

/**
 * Envoie une notification push à tous les appareils abonnés.
 * Si un abonnement n'est plus valide (410/404 — l'utilisateur a désinstallé
 * la PWA ou révoqué la permission), on le supprime de Firestore au passage.
 */
export async function sendPushToAll({ title, body }) {
  const snapshot = await db.collection('pushSubscriptions').get()
  const payload = JSON.stringify({ title, body })

  await Promise.all(
    snapshot.docs.map(async (doc) => {
      try {
        await webpush.sendNotification(doc.data().subscription, payload)
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await doc.ref.delete()
        } else {
          console.error(
            `[push] échec envoi vers ${doc.id} (statusCode=${err.statusCode}):`,
            err.body || err.message || err,
          )
        }
      }
    }),
  )
}
