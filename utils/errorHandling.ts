// Bootstrap error handling for uncaught exceptions and unhandled rejections
process.on("uncaughtException", (err: any) => {
  if (err?.code === "ECONNRESET" || err?.name === "AbortError") return
  console.error("[uncaughtException]", err)
})

process.on("unhandledRejection", (err: any) => {
  const e: any = err
  if (e?.code === "ECONNRESET" || e?.name === "AbortError") return
  console.error("[unhandledRejection]", err)
})

// Safe fetch wrapper that handles connection resets gracefully
export async function safeFetch(url: string, init?: RequestInit) {
  try {
    return await fetch(url, init)
  } catch (err: any) {
    if (err?.code === "ECONNRESET" || err?.name === "AbortError") {
      // connection dropped; ignore or retry once
      return null
    }
    throw err
  }
}

// Throttle function to limit concurrent API calls
export function throttle<T extends (...args: any[]) => Promise<any>>(fn: T, limit = 5): T {
  let inFlight = 0
  const queue: Array<() => void> = []

  return (async (...args: any[]) => {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        inFlight++
        try {
          const result = await fn(...args)
          resolve(result)
        } catch (error) {
          reject(error)
        } finally {
          inFlight--
          if (queue.length > 0 && inFlight < limit) {
            const next = queue.shift()
            next?.()
          }
        }
      }

      if (inFlight < limit) {
        execute()
      } else {
        queue.push(execute)
      }
    })
  }) as T
}
