import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

export async function sendResetEmail(to, resetLink) {
  await transporter.sendMail({
    from: `"mymt5" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Réinitialisation de votre mot de passe',
    html: `
      <p>Tu as demandé la réinitialisation de ton mot de passe.</p>
      <p><a href="${resetLink}">Clique ici pour choisir un nouveau mot de passe</a></p>
      <p>Ce lien expire dans 1 heure. Si tu n'es pas à l'origine de cette demande, ignore cet email.</p>
    `,
  })
}
