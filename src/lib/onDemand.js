function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function requestAndPoll({ request, fetch, isFresh, attempts = 8, delayMs = 1500, isCancelled }) {
  const requestedAt = Date.now()
  try {
    await request()
  } catch {
    return null
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    await sleep(delayMs)
    if (isCancelled?.()) return null
    try {
      const data = await fetch()
      if (isFresh(data, requestedAt)) return data
    } catch {
      // le VPS n'a peut-être pas encore répondu, on retente
    }
  }
  return null
}

export function isFreshTs(data, requestedAt) {
  return typeof data?.ts === 'number' && data.ts * 1000 >= requestedAt
}
