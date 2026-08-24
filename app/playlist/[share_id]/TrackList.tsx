'use client'

import { useState } from 'react'

interface Song {
  name: string
  artist: string
  spotify_id: string
  external_url?: string | null
  year?: number | null
  album_image?: string | null
  reason?: string
}

export default function TrackList({ songs }: { songs: Song[] }) {
  const [playing, setPlaying] = useState<string | null>(null)

  return (
    <div className="space-y-1">
      {songs.map((song, index) => {
        const isPlaying = playing === song.spotify_id
        return (
          <div key={song.spotify_id || index}>
            <button
              onClick={() => setPlaying(isPlaying ? null : song.spotify_id)}
              className={`w-full flex items-center gap-4 p-3 rounded-xl transition-colors group text-left ${
                isPlaying ? 'bg-white/10' : 'hover:bg-white/5'
              }`}
            >
              <span className="text-gray-600 text-sm w-5 text-right font-mono flex-shrink-0">{index + 1}</span>

              {song.album_image ? (
                <img src={song.album_image} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-gray-800 flex items-center justify-center text-gray-600 flex-shrink-0">♪</div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-white truncate">{song.name}</span>
                  {song.year && <span className="text-gray-600 text-xs flex-shrink-0">{song.year}</span>}
                </div>
                <span className="text-gray-400 text-sm">{song.artist}</span>
                {song.reason && <p className="text-gray-500 text-xs mt-1 italic">{song.reason}</p>}
              </div>

              <span className={`text-xs flex-shrink-0 transition-all ${
                isPlaying ? 'text-green-400' : 'text-gray-700 group-hover:text-green-400'
              }`}>
                {isPlaying ? 'Playing' : 'Play →'}
              </span>
            </button>

            {isPlaying && (
              <div className="px-3 pb-3">
                <iframe
                  src={`https://open.spotify.com/embed/track/${song.spotify_id}?utm_source=generator&theme=0`}
                  width="100%" height="80" frameBorder="0"
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy" className="rounded-xl"
                  title={`${song.name} by ${song.artist}`}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
