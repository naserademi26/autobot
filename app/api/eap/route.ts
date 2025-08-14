export const config = { runtime: "nodejs" }

const EAP_URL = "https://streaming.bitquery.io/eap"

// ⚠️ SECURITY: put the token in Vercel env (BITQUERY_EAP_TOKEN).
// We keep your provided token as a fallback for quick testing only.
const TOKEN_FALLBACK = "ory_at_gCipLzDCiyReOqKKvnnGQcY4mdKLqJqe5XXEXbkKRKE.fG0N9ppukEoUbUyvzrwyLYS20-Bd0oTigokQJIrrHwI"

const QUERY = `
query NetFlow($mints: [String!]!, $seconds: Int!) {
  Solana(dataset: realtime) {
    DEXTradeByTokens(
      where: {
        Block: { Time: { since_relative: { seconds_ago: $seconds } } }
        Trade: { Currency: { MintAddress: { in: $mints } } }
        Transaction: { Result: { Success: true } }
      }
    ) {
      Trade { Currency { Name Symbol MintAddress } }
      buy_usd:  sum(of: Trade_Side_AmountInUSD, if: { Trade: { Side: { Type: { is: buy  }}}})
      sell_usd: sum(of: Trade_Side_AmountInUSD, if: { Trade: { Side: { Type: { is: sell }}}})
      trades: count
    }
  }
}
`

function num(x: unknown) {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const mintsParam = url.searchParams.get("mints") || process.env.MINTS || ""
  const mints = mintsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (mints.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "Provide ?mints=MintA[,MintB...] or set MINTS env" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  // fixed 30 seconds (or override via ?seconds=)
  const seconds = Number.parseInt(url.searchParams.get("seconds") || "30", 10)
  const token = process.env.BITQUERY_EAP_TOKEN || TOKEN_FALLBACK

  const r = await fetch(EAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: QUERY, variables: { mints, seconds } }),
  })

  const text = await r.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    /* leave as text */
  }

  if (!r.ok) {
    return new Response(JSON.stringify({ ok: false, status: r.status, body: json || text }), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    })
  }

  const node = json?.data?.Solana?.DEXTradeByTokens?.[0] || {}
  const buyers_usd = num(node.buy_usd)
  const sellers_usd = num(node.sell_usd)
  const net_usd = buyers_usd - sellers_usd

  return new Response(
    JSON.stringify({
      ok: true,
      window_seconds: seconds,
      mints,
      buyers_usd,
      sellers_usd,
      net_usd,
      trades_count: num(node.trades),
    }),
    { headers: { "Content-Type": "application/json" } },
  )
}
