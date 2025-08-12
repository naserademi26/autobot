import type { NextRequest } from "next/server"

export async function POST(request: NextRequest) {
  return Response.json(
    {
      success: false,
      error: "Auto-sell functionality has been removed",
    },
    { status: 410 },
  )
}

export async function GET() {
  return Response.json(
    {
      success: false,
      error: "Auto-sell functionality has been removed",
    },
    { status: 410 },
  )
}
