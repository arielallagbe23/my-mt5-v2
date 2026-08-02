const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : `http://${window.location.hostname}:4000`)

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (!res.ok) {
    throw new Error(data?.error ?? 'Une erreur est survenue')
  }
  return data
}

export const api = {
  signup: (email, password) => request('/api/auth/signup', { method: 'POST', body: { email, password } }),
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
  accountStatus: () => request('/api/account/status'),
  requestAccountStatus: () => request('/api/account/status/request', { method: 'POST' }),
  forgotPassword: (email) =>
    request('/api/auth/forgot-password', { method: 'POST', body: { email, origin: window.location.origin } }),
  resetPassword: (token, password) =>
    request('/api/auth/reset-password', { method: 'POST', body: { token, password } }),
  updateProfile: (pseudo) => request('/api/auth/profile', { method: 'PATCH', body: { pseudo } }),
  price: (symbol) => request(`/api/prices/${symbol}`),
  requestPrice: (symbol) => request(`/api/prices/${symbol}/request`, { method: 'POST' }),
  candle: (symbol) => request(`/api/candles/${symbol}`),
  requestCandle: (symbol, timeframe, time) =>
    request(`/api/candles/${symbol}/request`, { method: 'POST', body: { timeframe, time } }),
  positions: () => request('/api/positions'),
  requestPositions: () => request('/api/positions/request', { method: 'POST' }),
  trades: () => request('/api/trades'),
  syncTrades: () => request('/api/trades/sync', { method: 'POST' }),
  subscribePush: (subscription) => request('/api/push/subscribe', { method: 'POST', body: subscription }),
  unsubscribePush: () => request('/api/push/subscribe', { method: 'DELETE' }),
  listTasks: () => request('/api/tasks'),
  getTask: (id) => request(`/api/tasks/${id}`),
  createTask: (task) => request('/api/tasks', { method: 'POST', body: task }),
  updateTask: (id, task) => request(`/api/tasks/${id}`, { method: 'PATCH', body: task }),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
}
