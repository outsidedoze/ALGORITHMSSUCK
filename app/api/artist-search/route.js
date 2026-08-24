import { auth } from '@clerk/nextjs/server'
import { spotifySearch } from '@/lib/spotify'

export async function GET(request) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const q = new URL(request.url).searchParams.get('q')
    if (!q || q.trim().length < 2) {
      return Response.json({ artists: [] })
    }

    const data = await spotifySearch(q.trim(), 'artist', 8)

    if (!data?.artists?.items) {
      return Response.json({ artists: [] })
    }

    const artists = data.artists.items.map(a => ({
      id: a.id,
      name: a.name,
      image: a.images?.[2]?.url || a.images?.[1]?.url || a.images?.[0]?.url || null,
      genres: (a.genres || []).slice(0, 2),
    }))

    return Response.json({ artists })
  } catch (err) {
    console.error('artist-search error:', err)
    return Response.json({ artists: [], error: err.message }, { status: 500 })
  }
}
