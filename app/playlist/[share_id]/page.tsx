import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import TrackList from './TrackList'

interface Song {
  name: string
  artist: string
  spotify_id: string
  external_url?: string | null
  year?: number | null
  album_image?: string | null
  reason?: string
}

interface PlaylistData {
  title: string
  prompt: string
  songs: Song[]
  created_at: string
  play_count: number
}

export default async function SharedPlaylistPage({
  params,
}: {
  params: Promise<{ share_id: string }>
}) {
  const { share_id } = await params

  const { data: playlist, error } = await supabase
    .from('playlists')
    .select('*')
    .eq('share_id', share_id)
    .single()

  if (error || !playlist) {
    notFound()
  }

  supabase
    .from('playlists')
    .update({ play_count: (playlist.play_count || 0) + 1 })
    .eq('share_id', share_id)
    .then(() => {})

  const data = playlist as PlaylistData
  const songs = (data.songs || []) as Song[]
  const createdDate = new Date(data.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  const covers = songs.filter(s => s.album_image).slice(0, 5)

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="bg-gradient-to-b from-green-900/30 to-gray-950 pt-12 pb-8 px-6">
        <div className="max-w-2xl mx-auto">
          <Link href="/" className="text-green-400 text-sm font-medium hover:text-green-300 transition-colors">
            algorithmssuck.com
          </Link>

          {covers.length > 0 && (
            <div className="flex gap-1.5 mt-6 mb-5">
              {covers.map((s, i) => (
                <img
                  key={i}
                  src={s.album_image as string}
                  alt=""
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg object-cover"
                />
              ))}
            </div>
          )}

          <h1 className="text-3xl md:text-4xl font-bold mb-3">{data.title}</h1>
          <p className="text-gray-400 text-lg italic mb-4">&ldquo;{data.prompt}&rdquo;</p>

          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span>{songs.length} songs</span>
            <span>·</span>
            <span>{createdDate}</span>
          </div>

          <div className="flex gap-3 mt-6">
            <Link
              href="/"
              className="inline-flex items-center px-5 py-2.5 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors font-medium text-sm"
            >
              Make your own
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 pb-32">
        <p className="text-gray-700 text-xs mb-4">Tap any track to listen</p>
        <TrackList songs={songs} />
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-gray-950 via-gray-950/95 to-transparent pt-12 pb-6 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <Link
            href="/"
            className="inline-flex items-center px-8 py-3 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors font-semibold text-base"
          >
            Discover your own playlist →
          </Link>
          <p className="text-gray-600 text-xs mt-2">Powered by taste, not algorithms</p>
        </div>
      </div>
    </main>
  )
}
