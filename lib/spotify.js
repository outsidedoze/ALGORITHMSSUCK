// App-level Spotify access using the Client Credentials flow.
// This does NOT authorize a user, so it is not subject to the
// Development Mode authorized-user cap. Used for catalog search,
// track metadata and album art only.

let cachedToken = null
let tokenExpiresAt = 0

export async function getAppToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET')
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basic}`,
    },
    body: 'grant_type=client_credentials',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Spotify client-credentials token failed: ${res.status} ${text}`)
  }

  const data = await res.json()
  cachedToken = data.access_token
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000
  return cachedToken
}

// Search the Spotify catalog. `limit` max is 10 as of Feb 2026.
export async function spotifySearch(query, type = 'track', limit = 5) {
  const token = await getAppToken()
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&limit=${Math.min(limit, 10)}`

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
  })

  if (!res.ok) {
    if (res.status === 401) {
      cachedToken = null
      tokenExpiresAt = 0
    }
    return null
  }

  return res.json()
}

// Normalise a Spotify track object into the shape the app uses.
export function normaliseTrack(track, reason = null) {
  if (!track) return null
  return {
    name: track.name,
    artist: track.artists?.[0]?.name || 'Unknown',
    spotify_id: track.id,
    spotify_uri: `spotify:track:${track.id}`,
    external_url: track.external_urls?.spotify || null,
    preview_url: track.preview_url || null,
    popularity: typeof track.popularity === 'number' ? track.popularity : null,
    year: track.album?.release_date
      ? new Date(track.album.release_date).getFullYear()
      : null,
    album_image: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || null,
    album_name: track.album?.name || null,
    reason,
  }
}
