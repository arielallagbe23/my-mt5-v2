const isProd = process.env.NODE_ENV === 'production'
const devOriginPattern =
  /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):5173$/

export function isAllowedOrigin(origin) {
  if (!origin) return false
  if (isProd) return origin === process.env.CLIENT_ORIGIN
  return devOriginPattern.test(origin)
}

export function resolveOrigin(candidate) {
  if (isAllowedOrigin(candidate)) return candidate
  return isProd ? process.env.CLIENT_ORIGIN : 'http://localhost:5173'
}
