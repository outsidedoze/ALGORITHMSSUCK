import { auth, currentUser } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  try {
    const { userId } = await auth()
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { data, error } = await supabase
      .from('users')
      .select('favorite_artists, playlist_count, is_subscribed, credits')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error('taste GET error:', error.message)
      return Response.json({ favorite_artists: [] })
    }

    return Response.json({
      favorite_artists: data?.favorite_artists || [],
      playlist_count: data?.playlist_count || 0,
      is_subscribed: data?.is_subscribed || false,
      credits: data?.credits || 0,
    })
  } catch (err) {
    console.error('taste GET error:', err)
    return Response.json({ favorite_artists: [] })
  }
}

export async function POST(request) {
  try {
    const { userId } = await auth()
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { favorite_artists } = await request.json()

    if (!Array.isArray(favorite_artists)) {
      return Response.json({ error: 'favorite_artists must be an array' }, { status: 400 })
    }

    // Keep it sane: max 25 artists, strings only
    const cleaned = favorite_artists
      .filter(a => typeof a === 'string' && a.trim().length > 0)
      .map(a => a.trim())
      .slice(0, 25)

    const user = await currentUser()
    const email = user?.emailAddresses?.[0]?.emailAddress || ''

    const { error } = await supabase
      .from('users')
      .upsert({ id: userId, email, favorite_artists: cleaned }, { onConflict: 'id' })

    if (error) {
      console.error('taste POST error:', error.message)
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ success: true, favorite_artists: cleaned })
  } catch (err) {
    console.error('taste POST error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
