export default async function handler(_req: Request) {
  return new Response(JSON.stringify({ error: "Auto-sell functionality has been removed" }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
}
