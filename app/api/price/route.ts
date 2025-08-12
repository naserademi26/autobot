import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tokenMint = searchParams.get("token")

    if (!tokenMint) {
      return NextResponse.json({ error: "Token mint is required" }, { status: 400 })
    }

    // Try Jupiter Price API first
    try {
      const jupiterResponse = await fetch(`https://price.jup.ag/v4/price?ids=${tokenMint}`, {
        headers: {
          Accept: "application/json",
        },
      })

      if (jupiterResponse.ok) {
        const jupiterData = await jupiterResponse.json()

        if (jupiterData.data && jupiterData.data[tokenMint]) {
          const priceData = jupiterData.data[tokenMint]

          return NextResponse.json({
            success: true,
            source: "Jupiter",
            data: {
              price: priceData.price || 0,
              priceChange24h: 0,
              volume24h: 0,
              marketCap: 0,
            },
          })
        }
      }
    } catch (jupiterError) {
      console.log("Jupiter API failed, trying DexScreener...")
    }

    // Fallback to DexScreener
    const dexResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`, {
      headers: {
        Accept: "application/json",
      },
    })

    if (!dexResponse.ok) {
      throw new Error(`DexScreener API failed: ${dexResponse.status}`)
    }

    const dexData = await dexResponse.json()

    if (dexData.pairs && dexData.pairs.length > 0) {
      // Use the pair with highest liquidity
      const bestPair = dexData.pairs.reduce((best: any, current: any) =>
        (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best,
      )

      return NextResponse.json({
        success: true,
        source: "DexScreener",
        data: {
          price: Number.parseFloat(bestPair.priceUsd) || 0,
          priceChange24h: Number.parseFloat(bestPair.priceChange?.h24) || 0,
          volume24h: Number.parseFloat(bestPair.volume?.h24) || 0,
          marketCap: Number.parseFloat(bestPair.marketCap) || 0,
        },
      })
    } else {
      throw new Error("No price data found for this token")
    }
  } catch (error) {
    console.error("Price API error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch price data",
      },
      { status: 500 },
    )
  }
}
