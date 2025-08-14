export const runtime = "edge"

import { type NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  const { mint } = await req.json().catch(() => ({}))
  if (!mint || typeof mint !== "string" || mint.length < 32) {
    return NextResponse.json({ ok: false, error: "Invalid mint" }, { status: 400 })
  }

  const key = process.env.HELIUS_API_KEY!
  const wid = process.env.HELIUS_WEBHOOK_ID!
  if (!key || !wid) {
    return NextResponse.json({ ok: false, error: "Missing HELIUS_API_KEY/WEBHOOK_ID" }, { status: 500 })
  }

  const base = `https://api.helius.xyz/v0/webhooks/${wid}?api-key=${key}`
  const getRes = await fetch(base)
  if (!getRes.ok) return NextResponse.json({ ok: false, error: "Failed to fetch webhook" }, { status: 502 })
  const cfg = await getRes.json()

  const list: string[] = Array.isArray(cfg.accountAddresses) ? cfg.accountAddresses : []
  if (!list.includes(mint)) list.push(mint)

  const patchRes = await fetch(base, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountAddresses: list }),
  })

  if (!patchRes.ok) {
    const txt = await patchRes.text()
    return NextResponse.json({ ok: false, error: "Failed to update webhook", details: txt }, { status: 502 })
  }

  return NextResponse.json({ ok: true, watching: mint, total: list.length })
}
