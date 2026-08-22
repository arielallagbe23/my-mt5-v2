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
  allAccountsStatus: () => request('/api/account/all'),
  updateAccountSettings: (vpsId, settings) =>
    request(`/api/account/${vpsId}/settings`, { method: 'PATCH', body: settings }),
  requestSwitchAccount: (login, password, server) =>
    request('/api/account/switch', { method: 'POST', body: { login, password, server } }),
  switchAccountResult: () => request('/api/account/switch/result'),
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
  activatePositionMonitoring: (ticket, timeframe) =>
    request(`/api/positions/${ticket}/activate-monitoring`, { method: 'POST', body: { timeframe } }),
  requestClosePosition: (ticket) => request(`/api/positions/${ticket}/close`, { method: 'POST' }),
  closePositionResult: () => request('/api/positions/close/result'),
  trailingHistory: (ticket) => request(`/api/positions/${ticket}/trailing-history`),
  trades: () => request('/api/trades'),
  syncTrades: () => request('/api/trades/sync', { method: 'POST' }),
  importTrades: (trades) => request('/api/trades/import', { method: 'POST', body: { trades } }),
  reports: () => request('/api/reports'),
  archiveReport: (id) => request(`/api/reports/${id}/archive`, { method: 'POST' }),
  deleteReport: (id) => request(`/api/reports/${id}`, { method: 'DELETE' }),
  subscribePush: (subscription) => request('/api/push/subscribe', { method: 'POST', body: subscription }),
  unsubscribePush: () => request('/api/push/subscribe', { method: 'DELETE' }),
  listTasks: () => request('/api/tasks'),
  getTask: (id) => request(`/api/tasks/${id}`),
  createTask: (task) => request('/api/tasks', { method: 'POST', body: task }),
  updateTask: (id, task) => request(`/api/tasks/${id}`, { method: 'PATCH', body: task }),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
  requestSetOrder: (order) => request('/api/set-order/request', { method: 'POST', body: order }),
  setOrderResult: () => request('/api/set-order/result'),
  riskSettings: () => request('/api/settings/risk'),
  updateRiskSettings: (settings) => request('/api/settings/risk', { method: 'PATCH', body: settings }),
  alertSettings: () => request('/api/settings/alerts'),
  updateAlertSettings: (settings) => request('/api/settings/alerts', { method: 'PATCH', body: settings }),
  marketRecap: () => request('/api/market-recap'),
  requestMarketRecapRefresh: () => request('/api/market-recap/request', { method: 'POST' }),
  marketRecapRefreshStatus: () => request('/api/market-recap/request/status'),
}
