import type { NextRequest } from "next/server"

export async function POST(request: NextRequest) {
  return Response.json(
    {
      success: true,
      message: "Auto-sell functionality is available via /api/auto-sell/start",
    },
    { status: 200 },
  )
}

export async function GET() {
  return Response.json(
    {
      success: true,
      message: "Auto-sell functionality is available. Use POST /api/auto-sell/start to begin.",
    },
    { status: 200 },
  )
}
