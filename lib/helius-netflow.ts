const WINDOW_SECONDS = Number(process.env.WINDOW_SECONDS ?? "120")

function heliusRpcUrl() {
  const { HELIUS_RPC_URL, RPC_URL, NEXT_PUBLIC_RPC_URL, NEXT_PUBLIC_HELIUS_RPC_URL, HELIUS_API_KEY } =
    process.env as any
  return (
    HELIUS_RPC_URL ||
    RPC_URL ||
    NEXT_PUBLIC_RPC_URL ||
    NEXT_PUBLIC_HELIUS_RPC_URL ||
    (HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}` : undefined)
  )
}

export async function getWindowSumsUSD(mintAddress: string): Promise<{ buyers_usd: number; sellers_usd: number }> {
  const now = Date.now()
  const start = Math.floor((now - WINDOW_SECONDS * 1000) / 1000)
  const end = Math.floor(now / 1000)

  const aggregator = process.env.HELIUS_NETFLOW_ENDPOINT
  if (aggregator) {
    try {
      const res = await fetch(`${aggregator}?mint=${mintAddress}&start=${start}&end=${end}`, { cache: "no-store" })
      if (res.ok) return await res.json()
    } catch (e) {
      console.error("Aggregator failed, falling back to Helius RPC:", e)
    }
  }

  const url = heliusRpcUrl()
  if (!url) {
    console.warn("No Helius RPC URL configured, returning zero volume")
    return { buyers_usd: 0, sellers_usd: 0 }
  }

  try {
    const body = {
      jsonrpc: "2.0",
      id: "autosell-net",
      method: "getEnrichedTransactions",
      params: {
        startTime: start,
        endTime: end,
        limit: 1000,
        accounts: [mintAddress],
      },
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    if (!res.ok) return { buyers_usd: 0, sellers_usd: 0 }

    const data = await res.json()
    let buyers_usd = 0
    let sellers_usd = 0

    // Parse enriched transactions and sum USD values
    if (data.result && Array.isArray(data.result)) {
      for (const tx of data.result) {
        if (tx.tokenTransfers) {
          for (const transfer of tx.tokenTransfers) {
            if (transfer.mint === mintAddress && transfer.tokenAmount) {
              const usdValue = transfer.tokenAmount * (transfer.tokenPrice || 0)
              if (transfer.fromUserAccount && !transfer.toUserAccount) {
                sellers_usd += usdValue
              } else if (!transfer.fromUserAccount && transfer.toUserAccount) {
                buyers_usd += usdValue
              }
            }
          }
        }
      }
    }

    return { buyers_usd, sellers_usd }
  } catch (e) {
    console.error("Helius fetch failed:", e)
    return { buyers_usd: 0, sellers_usd: 0 }
  }
}
