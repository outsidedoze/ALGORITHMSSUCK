'use client'

import { useEffect, useState, useRef } from 'react'
import { useUser, SignInButton, SignOutButton } from '@clerk/nextjs'

interface Song {
  name: string
  artist: string
  spotify_id: string
  preview_url?: string
  external_url: string
  popularity: number
  year?: number
  album_image?: string
  album_name?: string
  reason?: string
}

interface PlaylistResult {
  success: boolean
  message: string
  title?: string
  prompt: string
  songs: Song[]
  playlist_id?: string
  playlist_url?: string
  share_url?: string
}

const LOADING_MESSAGES = [
  'Digging through the crates...',
  'Following the thread...',
  'Reading your musical DNA...',
  'Tracing the lineage...',
  'Finding what the algorithm buried...',
  'Consulting 70 years of music history...',
  'Looking beyond the obvious...',
  "Pulling from scenes you've never heard of...",
  'Almost there — this one takes real thought...',
  'Your curator is on it...',
]

async function generateCodeVerifier(length = 128) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  let text = ''
  for (let i = 0; i < length; i++) text += possible.charAt(Math.floor(Math.random() * possible.length))
  return text
}

async function generateCodeChallenge(verifier: string) {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function Slider({ label, leftLabel, rightLabel, value, onChange }: {
  label: string; leftLabel: string; rightLabel: string; value: number; onChange: (v: number) => void
}) {
  return (
    <div className="mb-4">
      <span className="text-gray-400 text-xs font-medium uppercase tracking-wide block mb-2">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-gray-600 text-xs w-20 text-right leading-tight">{leftLabel}</span>
        <input type="range" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer accent-green-500" />
        <span className="text-gray-600 text-xs w-20 leading-tight">{rightLabel}</span>
      </div>
    </div>
  )
}

function PopularityBadge({ popularity }: { popularity: number }) {
  if (popularity < 30) return <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-400">🔥 Very Obscure</span>
  if (popularity < 50) return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900/40 text-yellow-400">💎 Hidden Gem</span>
  if (popularity < 70) return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">⭐ Lesser Known</span>
  return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-600">📻 Popular</span>
}

export default function HomePage() {
  const { isLoaded, isSignedIn, user } = useUser()
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0])
  const [playlistResult, setPlaylistResult] = useState<PlaylistResult | null>(null)
  const [showPaywall, setShowPaywall] = useState(false)
  const [showRefine, setShowRefine] = useState(false)

  // Sliders
  const [modeSlider, setModeSlider] = useState(50)
  const [eraSlider, setEraSlider] = useState(50)
  const [obscuritySlider, setObscuritySlider] = useState(75)

  // Selected track for detail panel
  const [selectedSong, setSelectedSong] = useState<Song | null>(null)
  const [detailVisible, setDetailVisible] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)

  // Feedback
  const [feedback, setFeedback] = useState<Record<string, number>>({})

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (token) setSpotifyToken(token)
  }, [])

  useEffect(() => {
    if (!isLoading) return
    setLoadingMessage(LOADING_MESSAGES[0])
    let i = 1
    const interval = setInterval(() => {
      setLoadingMessage(LOADING_MESSAGES[i % LOADING_MESSAGES.length])
      i++
    }, 2500)
    return () => clearInterval(interval)
  }, [isLoading])

  // Animate detail panel in when song selected
  useEffect(() => {
    if (selectedSong) {
      setDetailVisible(false)
      const t = setTimeout(() => {
        setDetailVisible(true)
        setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
      }, 50)
      return () => clearTimeout(t)
    } else {
      setDetailVisible(false)
    }
  }, [selectedSong])

  const handleConnectSpotify = async () => {
    localStorage.removeItem('code_verifier')
    localStorage.removeItem('access_token')
    const verifier = await generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    localStorage.setItem('code_verifier', verifier)
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: '2ee0d98b21d048978bf73d78924daf91',
      scope: 'user-read-private user-read-email playlist-modify-public playlist-modify-private user-read-recently-played user-top-read user-library-read',
      redirect_uri: 'https://www.algorithmssuck.com/callback',
      code_challenge_method: 'S256',
      code_challenge: challenge,
    })
    window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`
  }

  const handleDisconnectSpotify = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('code_verifier')
    setSpotifyToken(null)
  }

  const handleGeneratePlaylist = async () => {
    if (!prompt.trim() || !spotifyToken) return
    setIsLoading(true)
    setSelectedSong(null)
    setFeedback({})

    try {
      const response = await fetch('/api/generate-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt, access_token: spotifyToken,
          mode_slider: modeSlider,
          era_slider: eraSlider,
          obscurity_slider: obscuritySlider,
        }),
      })
      const data = await response.json()
      if (data.paywall) { setShowPaywall(true); return }
      if (!response.ok) { alert('Error: ' + (data.error || data.message || 'Unknown error')); return }
      if (data.success) {
        setPlaylistResult(data)
        setShowPaywall(false)
        setPrompt('')
      } else {
        alert('Error: ' + (data.error || data.message || 'Unknown error'))
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelectSong = (song: Song) => {
    if (selectedSong?.spotify_id === song.spotify_id) {
      setSelectedSong(null)
    } else {
      setSelectedSong(song)
    }
  }

  const handleFeedback = async (song: Song, rating: 1 | -1, e: React.MouseEvent) => {
    e.stopPropagation()
    const existing = feedback[song.spotify_id] || 0
    const newRating = existing === rating ? 0 : rating
    setFeedback(prev => ({ ...prev, [song.spotify_id]: newRating }))
    if (newRating === 0) return
    try {
      await fetch('/api/track-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spotify_track_id: song.spotify_id,
          artist_name: song.artist,
          track_name: song.name,
          rating: newRating,
          playlist_share_id: playlistResult?.share_url?.split('/').pop() || null,
        }),
      })
    } catch (err) { console.error('Feedback error:', err) }
  }

  // ── Loading ──────────────────────────────────────────────────────────
  if (!isLoaded) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gray-950">
        <div className="flex space-x-1">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    )
  }

  // ── Not signed in ────────────────────────────────────────────────────
  if (!isSignedIn) {
    return (
      <main className="h-screen w-screen flex items-center justify-center bg-gray-950">
        <div className="text-center max-w-md px-6">
          <p className="text-green-400 text-sm font-medium mb-3 tracking-widest uppercase">algorithmssuck.com</p>
          <h1 className="text-4xl font-bold text-white mb-4">Music discovery.<br />No algorithm involved.</h1>
          <p className="text-gray-400 mb-8">Describe a vibe. Get 20 songs you&apos;ve never heard, curated by AI with genuinely good taste.</p>
          <SignInButton mode="modal">
            <button className="px-8 py-4 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors font-semibold text-lg">
              Get started
            </button>
          </SignInButton>
          <p className="text-gray-600 text-xs mt-4">3 free playlists. No credit card required.</p>
        </div>
      </main>
    )
  }

  // ── Spotify not connected ────────────────────────────────────────────
  if (!spotifyToken) {
    return (
      <main className="h-screen w-screen flex items-center justify-center bg-gray-950">
        <div className="text-center max-w-md px-6">
          <p className="text-green-400 text-sm mb-2">Hey {user.firstName || user.username} 👋</p>
          <h1 className="text-3xl font-bold text-white mb-4">Connect your Spotify</h1>
          <p className="text-gray-400 mb-8">We&apos;ll read your listening history to find music you haven&apos;t heard yet — not more of the same.</p>
          <button onClick={handleConnectSpotify} className="px-8 py-4 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors font-semibold">
            Connect Spotify
          </button>
          <div className="mt-6">
            <SignOutButton><button className="text-gray-600 text-sm hover:text-gray-400 transition-colors">Sign out</button></SignOutButton>
          </div>
        </div>
      </main>
    )
  }

  // ── Main app ─────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-3xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex justify-between items-center mb-10">
          <div>
            <p className="text-green-400 text-sm font-medium tracking-widest uppercase">algorithmssuck.com</p>
            <p className="text-gray-500 text-sm">{user.primaryEmailAddress?.emailAddress}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleDisconnectSpotify} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Disconnect Spotify</button>
            <SignOutButton>
              <button className="text-xs text-gray-500 hover:text-gray-300 bg-white/5 px-3 py-1.5 rounded-full transition-colors">Sign out</button>
            </SignOutButton>
          </div>
        </div>

        {/* Form — collapses when results are showing */}
        {!playlistResult && (
          <>
            <div className="mb-3">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGeneratePlaylist() }}
                placeholder="Describe a vibe, a moment, a feeling, a genre, a time period... anything."
                className="w-full p-5 bg-gray-900 border border-gray-800 rounded-2xl text-white placeholder-gray-600 focus:outline-none focus:border-green-700 resize-none text-base"
                rows={4}
              />
            </div>

            <div className="mb-4">
              <button onClick={() => setShowRefine(v => !v)} className="text-xs text-gray-600 hover:text-gray-400 transition-colors flex items-center gap-1.5">
                <span className={`transition-transform duration-200 inline-block ${showRefine ? 'rotate-90' : ''}`}>▶</span>
                Refine
              </button>
              {showRefine && (
                <div className="mt-4 p-5 bg-gray-900 border border-gray-800 rounded-2xl">
                  <Slider label="Mode" leftLabel="Genre strict" rightLabel="Pure vibe" value={modeSlider} onChange={setModeSlider} />
                  <Slider label="Era" leftLabel="Vintage" rightLabel="Modern" value={eraSlider} onChange={setEraSlider} />
                  <Slider label="Obscurity" leftLabel="Familiar anchors" rightLabel="Deep cuts only" value={obscuritySlider} onChange={setObscuritySlider} />
                  <p className="text-gray-700 text-xs mt-2">These shape how the AI interprets your request.</p>
                </div>
              )}
            </div>

            <button
              onClick={handleGeneratePlaylist}
              disabled={isLoading || !prompt.trim()}
              className="w-full py-4 bg-green-600 text-white rounded-2xl hover:bg-green-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors font-semibold text-base"
            >
              Find my music
            </button>
          </>
        )}

        {/* Compact "generate another" bar when results are showing */}
        {playlistResult && !isLoading && (
          <div className="mb-8 flex gap-3">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleGeneratePlaylist() }}
              placeholder="Try another vibe..."
              className="flex-1 px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-green-700 text-sm"
            />
            <button
              onClick={handleGeneratePlaylist}
              disabled={!prompt.trim()}
              className="px-5 py-3 bg-green-600 text-white rounded-xl hover:bg-green-500 disabled:bg-gray-800 disabled:text-gray-600 transition-colors font-semibold text-sm"
            >
              Go
            </button>
            <button
              onClick={() => { setPlaylistResult(null); setSelectedSong(null); setFeedback({}) }}
              className="px-4 py-3 text-gray-600 hover:text-gray-400 bg-gray-900 border border-gray-800 rounded-xl transition-colors text-sm"
            >
              Clear
            </button>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="mt-8 p-8 bg-gray-900 rounded-2xl text-center">
            <div className="flex justify-center mb-4 gap-1">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="w-1.5 bg-green-400 rounded-full animate-bounce"
                  style={{ height: `${16 + (i % 3) * 8}px`, animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
            <p className="text-white font-medium text-lg">{loadingMessage}</p>
            <p className="text-gray-600 text-sm mt-2">This takes 10–20 seconds. Real taste takes time.</p>
          </div>
        )}

        {/* Paywall */}
        {showPaywall && (
          <div className="mt-8 p-8 bg-gray-900 rounded-2xl text-center">
            <p className="text-3xl mb-3">🎵</p>
            <h3 className="text-white text-xl font-bold mb-2">You&apos;ve used your 3 free playlists</h3>
            <p className="text-gray-400 mb-6">Subscribe for unlimited discovery, or grab a credit pack.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button className="px-6 py-3 bg-green-600 text-white rounded-full font-semibold hover:bg-green-500 transition-colors">Subscribe — $4.99/month</button>
              <button className="px-6 py-3 bg-white/10 text-white rounded-full font-semibold hover:bg-white/20 transition-colors">Buy credits — 10 for $3</button>
            </div>
            <p className="text-gray-600 text-xs mt-4">Payments coming very soon.</p>
          </div>
        )}

        {/* ── Playlist result — Album grid ──────────────────────────────── */}
        {playlistResult && !isLoading && (
          <div>
            {/* Playlist header */}
            <div className="mb-6">
              {playlistResult.title && (
                <h2 className="text-white text-2xl font-bold mb-1">{playlistResult.title}</h2>
              )}
              <p className="text-gray-500 text-sm italic">&ldquo;{playlistResult.prompt}&rdquo;</p>
              <div className="flex gap-3 mt-4 flex-wrap">
                {playlistResult.playlist_url && (
                  <a href={playlistResult.playlist_url} target="_blank" rel="noopener noreferrer"
                    className="px-4 py-2 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors font-medium text-sm">
                    Open in Spotify →
                  </a>
                )}
                {playlistResult.share_url && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(playlistResult.share_url || '')
                      const btn = document.getElementById('copy-btn')
                      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy link' }, 2000) }
                    }}
                    id="copy-btn"
                    className="px-4 py-2 bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors font-medium text-sm"
                  >
                    Copy link
                  </button>
                )}
              </div>
            </div>

            {/* Album grid */}
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 mb-2">
              {playlistResult.songs.map((song, index) => {
                const isSelected = selectedSong?.spotify_id === song.spotify_id
                const myRating = feedback[song.spotify_id] || 0
                return (
                  <button
                    key={song.spotify_id}
                    onClick={() => handleSelectSong(song)}
                    className={`relative group aspect-square rounded-xl overflow-hidden transition-all duration-200 focus:outline-none ${
                      isSelected
                        ? 'ring-2 ring-green-400 scale-95 shadow-lg shadow-green-900/40'
                        : 'opacity-70 hover:opacity-100 hover:scale-95'
                    }`}
                  >
                    {/* Album art */}
                    {song.album_image ? (
                      <img src={song.album_image} alt={song.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                        <span className="text-gray-600 text-2xl">♪</span>
                      </div>
                    )}

                    {/* Track number */}
                    <div className="absolute top-1.5 left-1.5">
                      <span className="text-xs font-bold text-white/70 bg-black/50 rounded px-1">{index + 1}</span>
                    </div>

                    {/* Feedback buttons — visible on hover or if rated */}
                    <div className={`absolute top-1.5 right-1.5 flex gap-1 transition-opacity duration-150 ${myRating !== 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                      <button
                        onClick={(e) => handleFeedback(song, 1, e)}
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                          myRating === 1 ? 'bg-green-500 text-white' : 'bg-black/60 text-white/70 hover:bg-green-500/80'
                        }`}
                      >↑</button>
                      <button
                        onClick={(e) => handleFeedback(song, -1, e)}
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                          myRating === -1 ? 'bg-red-500 text-white' : 'bg-black/60 text-white/70 hover:bg-red-500/80'
                        }`}
                      >↓</button>
                    </div>

                    {/* Hover overlay with track name */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end p-2">
                      <div>
                        <p className="text-white text-xs font-semibold leading-tight truncate">{song.name}</p>
                        <p className="text-gray-300 text-xs truncate">{song.artist}</p>
                      </div>
                    </div>

                    {/* Selected indicator dot */}
                    {isSelected && (
                      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-green-400 rounded-full" />
                    )}
                  </button>
                )
              })}
            </div>

            <p className="text-gray-700 text-xs mb-6 text-center">Click an album to learn why we picked it for you</p>

            {/* ── Detail panel ──────────────────────────────────────────── */}
            <div
              ref={detailRef}
              className={`transition-all duration-500 ease-in-out overflow-hidden ${
                selectedSong && detailVisible ? 'max-h-[700px] opacity-100' : 'max-h-0 opacity-0'
              }`}
            >
              {selectedSong && (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

                  {/* Top section: art + info */}
                  <div className="flex gap-5 p-6">
                    {/* Album art — larger */}
                    <div className="flex-shrink-0">
                      {selectedSong.album_image ? (
                        <img
                          src={selectedSong.album_image}
                          alt={selectedSong.name}
                          className="w-28 h-28 sm:w-36 sm:h-36 rounded-xl object-cover shadow-xl"
                        />
                      ) : (
                        <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-xl bg-gray-800 flex items-center justify-center">
                          <span className="text-gray-600 text-4xl">♪</span>
                        </div>
                      )}
                    </div>

                    {/* Track info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div>
                          <h3 className="text-white text-xl font-bold leading-tight">{selectedSong.name}</h3>
                          <p className="text-gray-400 mt-0.5">
                            {selectedSong.artist}
                            {selectedSong.year && <span className="text-gray-600"> · {selectedSong.year}</span>}
                          </p>
                          {selectedSong.album_name && (
                            <p className="text-gray-600 text-xs mt-0.5 italic">{selectedSong.album_name}</p>
                          )}
                        </div>
                        <button
                          onClick={() => setSelectedSong(null)}
                          className="text-gray-600 hover:text-gray-400 transition-colors text-lg flex-shrink-0 mt-0.5"
                        >✕</button>
                      </div>

                      <div className="mt-2 mb-4">
                        {selectedSong.popularity !== undefined && (
                          <PopularityBadge popularity={selectedSong.popularity} />
                        )}
                      </div>

                      {/* Why we chose it */}
                      {selectedSong.reason && (
                        <div>
                          <p className="text-green-400 text-xs font-semibold uppercase tracking-widest mb-2">
                            Why we chose it for you
                          </p>
                          <p className="text-gray-300 text-sm leading-relaxed">{selectedSong.reason}</p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="mt-4 flex gap-2 items-center flex-wrap">
                        <a
                          href={selectedSong.external_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors font-medium text-xs"
                        >
                          Open in Spotify →
                        </a>
                        <div className="flex gap-1.5 ml-1">
                          <button
                            onClick={(e) => handleFeedback(selectedSong, 1, e)}
                            className={`px-3 py-2 rounded-full text-xs font-medium transition-colors ${
                              (feedback[selectedSong.spotify_id] || 0) === 1
                                ? 'bg-green-600/30 text-green-400'
                                : 'bg-white/5 text-gray-400 hover:bg-green-600/20 hover:text-green-400'
                            }`}
                          >
                            ↑ Love it
                          </button>
                          <button
                            onClick={(e) => handleFeedback(selectedSong, -1, e)}
                            className={`px-3 py-2 rounded-full text-xs font-medium transition-colors ${
                              (feedback[selectedSong.spotify_id] || 0) === -1
                                ? 'bg-red-900/30 text-red-400'
                                : 'bg-white/5 text-gray-400 hover:bg-red-900/20 hover:text-red-400'
                            }`}
                          >
                            ↓ Not for me
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Spotify embed player */}
                  <div className="px-6 pb-6">
                    <iframe
                      key={selectedSong.spotify_id}
                      src={`https://open.spotify.com/embed/track/${selectedSong.spotify_id}?utm_source=generator&theme=0`}
                      width="100%"
                      height="80"
                      frameBorder="0"
                      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                      loading="lazy"
                      className="rounded-xl"
                    />
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

        {/* Example prompts */}
        {!playlistResult && !isLoading && !showPaywall && (
          <div className="mt-10">
            <p className="text-gray-600 text-sm mb-3">Try something like:</p>
            <div className="space-y-2">
              {[
                'Late night driving alone through an empty city',
                'The feeling of a perfect Sunday morning with nowhere to be',
                "Music that sounds like it was made in a city you've never visited",
                'Sad but not wallowing — getting through it',
                "The opening scene of a film you haven't seen yet",
              ].map((example, i) => (
                <button key={i} onClick={() => setPrompt(example)}
                  className="block w-full text-left px-4 py-3 text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-xl transition-colors text-sm">
                  &ldquo;{example}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}

      </div>
    </main>
  )
}
