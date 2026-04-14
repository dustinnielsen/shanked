// Optional API proxy route - currently the app calls Anthropic directly
// This can be used in future to keep API calls server-side
export async function POST(request) {
  return new Response(JSON.stringify({ message: 'Use direct Anthropic API calls' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
