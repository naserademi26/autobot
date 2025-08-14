export async function subscribeMint(mint: string) {
  if (!mint || typeof mint !== "string" || mint.length < 32) {
    throw new Error("Invalid mint address")
  }

  const response = await fetch("/api/mints/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mint }),
  })

  const text = await response.text()
  const isJson = response.headers.get("content-type")?.includes("application/json")

  if (!response.ok) {
    throw new Error(`${response.status} ${text.slice(0, 300)}`)
  }

  return isJson ? JSON.parse(text) : null
}
