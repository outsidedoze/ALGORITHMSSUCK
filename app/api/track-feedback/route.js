import { supabase } from '@/lib/supabase'
import { auth } from '@clerk/nextjs/server'

export async function POST(request) {
  try {
    const { userId: clerkUserId } = await auth()
    if (!clerkUserId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { spotify_track_id, artist_name, track_name, rating, playlist_share_id } = await request.json()

    if (!rating || ![-1, 1].includes(rating)) {
      return Response.json({ error: 'Invalid rating — must be 1 or -1' }, { status: 400 })
    }

    // Upsert — one rating per user per track (updates if they change their mind)
    const { error } = await supabase
      .from('track_feedback')
      .upsert(
        {
          user_id: clerkUserId,
          spotify_track_id,
          artist_name,
          track_name,
          rating,
          playlist_share_id: playlist_share_id || null,
        },
        { onConflict: 'user_id,spotify_track_id' }
      )

    if (error) {
      console.error('track_feedback upsert error:', error.message)
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (err) {
    console.error('track-feedback error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
