import { getAppToken, spotifySearch } from '@/lib/spotify'

// Diagnostic endpoint. Reports whether the Spotify client-credentials
// flow works, without ever exposing the credentials themselves.
export async function GET() {
  const report = {
    env: {
      SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID ? 'present' : 'MISSING',
      SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET ? 'present' : 'MISSING',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? 'present' : 'MISSING',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'present' : 'MISSING',
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'present' : 'MISSING',
    },
    token: null,
    search: null,
  }

  try {
    const token = await getAppToken()
    report.token = token ? 'OK — app token obtained' : 'FAILED — no token returned'
  } catch (err) {
    report.token = `FAILED — ${err.message}`
    return Response.json(report, { status: 200 })
  }

  try {
    const data = await spotifySearch('radiohead', 'artist', 3)
    if (!data) {
      report.search = 'FAILED — search returned null (non-200 from Spotify)'
    } else if (data.artists?.items?.length) {
      report.search = `OK — ${data.artists.items.length} results, first: ${data.artists.items[0].name}`
    } else {
      report.search = 'FAILED — search returned 200 but zero results'
    }
  } catch (err) {
    report.search = `FAILED — ${err.message}`
  }

  return Response.json(report, { status: 200 })
}
