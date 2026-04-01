import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import Link from 'next/link'

interface Song {
  name: string
  artist: string
  spotify_id: string
  external_url: string
  popularity: number
  year?: number
  reason?: string
}

interface PlaylistData {
  title: string
  prompt: string
  songs: Song[]
  spotify_url: string | null
  created_at: string
  play_count: number
}

export default async function SharedPlaylistPage({
  params,
}: {
  params: Promise<{ share_id: string }>
}) {
  const { share_id } = await params

  // Fetch the playlist from Supabase
  const { data: playlist, error } = await supabase
    .from('playlists')
    .select('*')
    .eq('share_id', share_id)
    .eq('is_public', true)
    .single()

  if (error || !playlist) {
    notFound()
  }

  // Increment play count (fire and forget)
  supabase
    .from('playlists')
    .update({ play_count: (playlist.play_count || 0) + 1 })
    .eq('share_id', share_id)
    .then(() => {})

  const data = playlist as PlaylistData
  const songs = (data.songs || []) as Song[]
  const createdDate = new Date(data.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gradient-to-b from-green-900/40 to-gray-950 pt-12 pb-8 px-6">
        <div className="max-w-2xl mx-auto">
          <Link
            href="/"
            className="text-green-400 text-sm font-medium hover:text-green-300 transition-colors"
          >
            algorithmssuck.com
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold mt-4 mb-3">
            {data.title}
          </h1>
          <p className="text-gray-400 text-lg italic mb-4">
            &ldquo;{data.prompt}&rdquo;
          </p>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span>{songs.length} songs</span>
            <span>·</span>
            <span>{createdDate}</span>
          </div>

          <div className="flex gap-3 mt-6">
            {data.spotify_url && (
              <a
                href={data.spotify_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-5 py-2.5 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors font-medium text-sm"
              >
                Open in Spotify
              </a>
            )}
            <Link
              href="/"
              className="inline-flex items-center px-5 py-2.5 bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors font-medium text-sm"
            >
              Make your own
            </Link>
          </div>
        </div>
      </div>

      {/* Song list */}
      <div className="max-w-2xl mx-auto px-6 pb-16">
        <div className="space-y-1">
          {songs.map((song: Song, index: number) => (
            <div
              key={index}
              className="flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 transition-colors group"
            >
              <span className="text-gray-600 text-sm w-6 text-right font-mono">
                {index + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-white truncate">
                    {song.name}
                  </span>
                  {song.year && (
                    <span className="text-gray-600 text-xs flex-shrink-0">
                      {song.year}
                    </span>
                  )}
                </div>
                <span className="text-gray-400 text-sm">{song.artist}</span>
                {song.reason && (
                  <p className="text-gray-500 text-xs mt-1 italic">
                    {song.reason}
                  </p>
                )}
              </div>
              {song.external_url && (
                <a
                  href={song.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 hover:text-green-400 text-xs opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                >
                  Play →
                </a>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Footer CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-gray-950 via-gray-950/95 to-transparent pt-12 pb-6 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <Link
            href="/"
            className="inline-flex items-center px-8 py-3 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors font-semibold text-base"
          >
            Discover your own playlist →
          </Link>
          <p className="text-gray-600 text-xs mt-2">
            Powered by taste, not algorithms
          </p>
        </div>
      </div>
    </main>
  )
}
