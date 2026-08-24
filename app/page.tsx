'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useUser, SignInButton, SignOutButton } from '@clerk/nextjs'

interface Song {
  name: string
  artist: string
  spotify_id: string
  spotify_uri: string
  external_url: string
  preview_url?: string | null
  popularity?: number | null
  year?: number | null
  album_image?: string | null
  album_name?: string | null
  reason?: string
}

interface PlaylistResult {
  success: boolean
  title?: string
  prompt: string
  songs: Song[]
  share_url?: string | null
  spotify_uris?: string[]
}

interface ArtistSuggestion {
  id: string
  name: string
  image: string | null
  genres: string[]
}

const LOADING_MESSAGES = [
  'Digging through the crates...',
  'Following the thread...',
  'Reading your taste...',
  'Tracing the lineage...',
  'Finding what the algorithm buried...',
  'Consulting 70 years of music history...',
  'Looking beyond the obvious...',
  "Pulling from scenes you've never heard of...",
  'Verifying every pick actually exists...',
  'Your curator is on it...',
]

function Slider({ label, leftLabel, rightLabel, value, onChange }: {
  label: string; leftLabel: string; rightLabel: string; value: number; onChange: (v: number) => void
}) {
  return (
    <div className="mb-4">
      <span className="text-gray-400 text-xs font-medium uppercase tracking-wide block mb-2">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-gray-600 text-xs w-24 text-right leading-tight">{leftLabel}</span>
        <input
          type="range" min={0} max={100} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer accent-green-500"
        />
        <span className="text-gray-600 text-xs w-24 leading-tight">{rightLabel}</span>
      </div>
    </div>
  )
}

export default function HomePage() {
  const { isLoaded, isSignedIn, user } = useUser()

  // Taste profile
  const [tasteLoaded, setTasteLoaded] = useState(false)
  const [favoriteArtists, setFavoriteArtists] = useState<string[]>([])
  const [editingTaste, setEditingTaste] = useState(false)
  const [artistQuery, setArtistQuery] = useState('')
  const [suggestions, setSuggestions] = useState<ArtistSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  const [savingTaste, setSavingTaste] = useState(false)

  // Generation
  const [prompt, setPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0])
  const [playlistResult, setPlaylistResult] = useState<PlaylistResult | null>(null)
  const [showPaywall, setShowPaywall] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showRefine, setShowRefine] = useState(false)

  const [modeSlider, setModeSlider] = useState(50)
  const [eraSlider, setEraSlider] = useState(50)
  const [obscuritySlider, setObscuritySlider] = useState(75)

  // Result interaction
  const [selectedSong, setSelectedSong] = useState<Song | null>(null)
  const [detailVisible, setDetailVisible] = useState(false)
  const [feedback, setFeedback] = useState<Record<string, number>>({})
  const [showExport, setShowExport] = useState(false)
  const [copied, setCopied] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)

  // ── Load taste profile ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isSignedIn) return
    fetch('/api/taste')
      .then(r => r.json())
      .then(d => {
        setFavoriteArtists(d.favorite_artists || [])
        setTasteLoaded(true)
      })
      .catch(() => setTasteLoaded(true))
  }, [isSignedIn])

  // ── Loading message cycle ──────────────────────────────────────────────
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

  // ── Detail panel animation ─────────────────────────────────────────────
  useEffect(() => {
    if (selectedSong) {
      setDetailVisible(false)
      const t = setTimeout(() => {
        setDetailVisible(true)
        setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60)
      }, 40)
      return () => clearTimeout(t)
    }
    setDetailVisible(false)
  }, [selectedSong])

  // ── Artist autocomplete (debounced) ────────────────────────────────────
  useEffect(() => {
    const q = artistQuery.trim()
    if (q.length < 2) { setSuggestions([]); return }
    setSearching(true)
    const t = setTimeout(() => {
      fetch(`/api/artist-search?q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then(d => setSuggestions(d.artists || []))
        .catch(() => setSuggestions([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => { clearTimeout(t); setSearching(false) }
  }, [artistQuery])

  const addArtist = (name: string) => {
    if (favoriteArtists.includes(name) || favoriteArtists.length >= 25) return
    setFavoriteArtists(prev => [...prev, name])
    setArtistQuery('')
    setSuggestions([])
  }

  const removeArtist = (name: string) => {
    setFavoriteArtists(prev => prev.filter(a => a !== name))
  }

  const saveTaste = async () => {
    setSavingTaste(true)
    try {
      await fetch('/api/taste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite_artists: favoriteArtists }),
      })
      setEditingTaste(false)
    } finally {
      setSavingTaste(false)
    }
  }

  // ── Generate ───────────────────────────────────────────────────────────
  const handleGeneratePlaylist = async () => {
    if (!prompt.trim()) return
    setIsLoading(true)
    setSelectedSong(null)
    setFeedback({})
    setErrorMsg(null)
    setShowExport(false)

    try {
      const res = await fetch('/api/generate-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          mode_slider: modeSlider,
          era_slider: eraSlider,
          obscurity_slider: obscuritySlider,
        }),
      })
      const data = await res.json()

      if (data.paywall) { setShowPaywall(true); return }
      if (data.needs_taste) { setEditingTaste(true); return }

      if (data.success) {
        setPlaylistResult(data)
        setShowPaywall(false)
        setPrompt('')
      } else {
        setErrorMsg(data.message || data.error || 'Something went wrong. Try again.')
      }
    } catch {
      setErrorMsg('Network error. Try again.')
    } finally {
      setIsLoading(false)
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

  const copyUris = useCallback(() => {
    if (!playlistResult?.spotify_uris) return
    navigator.clipboard.writeText(playlistResult.spotify_uris.join('\n'))
    setCopied(true)
    setShowExport(true)
    setTimeout(() => setCopied(false), 2500)
  }, [playlistResult])

  // ── Render gates ───────────────────────────────────────────────────────
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

  if (!isSignedIn) {
    return (
      <main className="h-screen w-screen flex items-center justify-center bg-gray-950">
        <div className="text-center max-w-md px-6">
          <p className="text-green-400 text-sm font-medium mb-3 tracking-widest uppercase">algorithmssuck.com</p>
          <h1 className="text-4xl font-bold text-white mb-4">Music discovery.<br />No algorithm involved.</h1>
          <p className="text-gray-400 mb-8">Tell us what you love. Describe a vibe. Get 20 songs you&apos;ve never heard, curated by someone with genuinely good taste.</p>
          <SignInButton mode="modal">
            <button className="px-8 py-4 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors font-semibold text-lg">
              Get started
            </button>
          </SignInButton>
          <p className="text-gray-600 text-xs mt-4">3 free playlists. No credit card. No Spotify account required.</p>
        </div>
      </main>
    )
  }

  if (!tasteLoaded) {
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

  // ── Taste onboarding / editing ─────────────────────────────────────────
  const needsOnboarding = favoriteArtists.length === 0 || editingTaste

  if (needsOnboarding) {
    const MIN_ARTISTS = 5
    const canContinue = favoriteArtists.length >= MIN_ARTISTS
    return (
      <main className="min-h-screen bg-gray-950 text-white">
        <div className="max-w-xl mx-auto px-6 py-16">
          <p className="text-green-400 text-sm font-medium tracking-widest uppercase mb-3">algorithmssuck.com</p>
          <h1 className="text-3xl font-bold text-white mb-3">
            {editingTaste && favoriteArtists.length > 0 ? 'Your taste' : 'Who do you love?'}
          </h1>
          <p className="text-gray-400 mb-8">
            Name the artists you genuinely love — the ones you&apos;d mention to a friend in a record store.
            Not what you play most. What you&apos;d defend. Add as many as you like, five minimum.
          </p>

          <div className="relative mb-4">
            <input
              type="text"
              value={artistQuery}
              onChange={(e) => setArtistQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  // Prefer the top suggestion; otherwise take the raw typed name
                  const pick = suggestions[0]?.name || artistQuery.trim()
                  if (pick) addArtist(pick)
                }
              }}
              placeholder="Type an artist name, then press Enter"
              className="w-full px-5 py-4 bg-gray-900 border border-gray-800 rounded-2xl text-white placeholder-gray-600 focus:outline-none focus:border-green-700 text-base"
            />
            {searching && (
              <div className="absolute right-5 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-gray-700 border-t-green-400 rounded-full animate-spin" />
              </div>
            )}

            {suggestions.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-2 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl">
                {suggestions.map(a => (
                  <button
                    key={a.id}
                    onClick={() => addArtist(a.name)}
                    disabled={favoriteArtists.includes(a.name)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {a.image ? (
                      <img src={a.image} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center flex-shrink-0 text-gray-600">♪</div>
                    )}
                    <div className="min-w-0">
                      <p className="text-white text-sm truncate">{a.name}</p>
                      {a.genres.length > 0 && (
                        <p className="text-gray-600 text-xs truncate">{a.genres.join(', ')}</p>
                      )}
                    </div>
                    {favoriteArtists.includes(a.name) && (
                      <span className="ml-auto text-green-400 text-xs flex-shrink-0">Added</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {favoriteArtists.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-8">
              {favoriteArtists.map(name => (
                <button
                  key={name}
                  onClick={() => removeArtist(name)}
                  className="group px-3 py-2 bg-gray-900 border border-gray-800 hover:border-red-900 rounded-full text-sm text-gray-300 hover:text-red-400 transition-colors flex items-center gap-2"
                >
                  {name}
                  <span className="text-gray-700 group-hover:text-red-400 transition-colors">✕</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={saveTaste}
              disabled={!canContinue || savingTaste}
              className="px-6 py-3 bg-green-600 text-white rounded-full hover:bg-green-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors font-semibold"
            >
              {savingTaste ? 'Saving...' : canContinue ? 'Continue' : `Add ${MIN_ARTISTS - favoriteArtists.length} more`}
            </button>
            {editingTaste && favoriteArtists.length >= MIN_ARTISTS && (
              <button onClick={() => setEditingTaste(false)} className="text-gray-600 hover:text-gray-400 text-sm transition-colors">
                Cancel
              </button>
            )}
          </div>

          <div className="mt-10">
            <SignOutButton>
              <button className="text-gray-700 text-xs hover:text-gray-500 transition-colors">Sign out</button>
            </SignOutButton>
          </div>
        </div>
      </main>
    )
  }

  // ── Main app ───────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-3xl mx-auto px-6 py-10">

        <div className="flex justify-between items-start mb-10 gap-4">
          <div className="min-w-0">
            <p className="text-green-400 text-sm font-medium tracking-widest uppercase">algorithmssuck.com</p>
            <p className="text-gray-500 text-sm truncate">{user.primaryEmailAddress?.emailAddress}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button onClick={() => setEditingTaste(true)} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
              Edit taste ({favoriteArtists.length})
            </button>
            <SignOutButton>
              <button className="text-xs text-gray-500 hover:text-gray-300 bg-white/5 px-3 py-1.5 rounded-full transition-colors">Sign out</button>
            </SignOutButton>
          </div>
        </div>

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
              onClick={() => { setPlaylistResult(null); setSelectedSong(null); setFeedback({}); setShowExport(false) }}
              className="px-4 py-3 text-gray-600 hover:text-gray-400 bg-gray-900 border border-gray-800 rounded-xl transition-colors text-sm"
            >
              Clear
            </button>
          </div>
        )}

        {errorMsg && !isLoading && (
          <div className="mt-6 p-4 bg-red-950/40 border border-red-900/50 rounded-2xl">
            <p className="text-red-300 text-sm">{errorMsg}</p>
          </div>
        )}

        {isLoading && (
          <div className="mt-8 p-8 bg-gray-900 rounded-2xl text-center">
            <div className="flex justify-center mb-4 gap-1">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="w-1.5 bg-green-400 rounded-full animate-bounce"
                  style={{ height: `${16 + (i % 3) * 8}px`, animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
            <p className="text-white font-medium text-lg">{loadingMessage}</p>
            <p className="text-gray-600 text-sm mt-2">This takes 15–30 seconds. Real taste takes time.</p>
          </div>
        )}

        {showPaywall && (
          <div className="mt-8 p-8 bg-gray-900 rounded-2xl text-center">
            <h3 className="text-white text-xl font-bold mb-2">You&apos;ve used your free playlists</h3>
            <p className="text-gray-400 mb-6">Subscribe for unlimited discovery, or grab a credit pack.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button className="px-6 py-3 bg-green-600 text-white rounded-full font-semibold hover:bg-green-500 transition-colors">Subscribe — $4.99/month</button>
              <button className="px-6 py-3 bg-white/10 text-white rounded-full font-semibold hover:bg-white/20 transition-colors">Buy credits — 10 for $3</button>
            </div>
            <p className="text-gray-600 text-xs mt-4">Payments coming very soon.</p>
          </div>
        )}

        {/* ── Result ─────────────────────────────────────────────────────── */}
        {playlistResult && !isLoading && (
          <div>
            <div className="mb-6">
              {playlistResult.title && <h2 className="text-white text-2xl font-bold mb-1">{playlistResult.title}</h2>}
              <p className="text-gray-500 text-sm italic">&ldquo;{playlistResult.prompt}&rdquo;</p>

              <div className="flex gap-2 mt-4 flex-wrap">
                <button
                  onClick={copyUris}
                  className="px-4 py-2 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors font-medium text-sm"
                >
                  {copied ? 'Copied — now paste in Spotify' : 'Add to Spotify'}
                </button>
                {playlistResult.share_url && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(playlistResult.share_url || '')
                      const btn = document.getElementById('share-btn')
                      if (btn) { btn.textContent = 'Link copied'; setTimeout(() => { btn.textContent = 'Copy share link' }, 2000) }
                    }}
                    id="share-btn"
                    className="px-4 py-2 bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors font-medium text-sm"
                  >
                    Copy share link
                  </button>
                )}
              </div>

              {showExport && (
                <div className="mt-4 p-5 bg-gray-900 border border-green-900/40 rounded-2xl">
                  <p className="text-green-400 text-xs font-semibold uppercase tracking-widest mb-3">All 20 tracks copied</p>
                  <ol className="text-gray-300 text-sm space-y-1.5 list-decimal list-inside">
                    <li>Open the Spotify desktop app</li>
                    <li>Create a new playlist (or open an existing one)</li>
                    <li>Click into the track list area, then press <span className="text-white font-mono text-xs bg-white/10 px-1.5 py-0.5 rounded">⌘V</span> / <span className="text-white font-mono text-xs bg-white/10 px-1.5 py-0.5 rounded">Ctrl+V</span></li>
                  </ol>
                  <p className="text-gray-600 text-xs mt-3">
                    On mobile or web?{' '}
                    <a href="https://www.tunemymusic.com/transfer/freetext-to-spotify" target="_blank" rel="noopener noreferrer" className="text-green-500 hover:text-green-400 underline">
                      Paste them into TuneMyMusic
                    </a>{' '}instead — it builds the playlist for you.
                  </p>
                  <button onClick={() => setShowExport(false)} className="text-gray-700 hover:text-gray-500 text-xs mt-3 transition-colors">Dismiss</button>
                </div>
              )}
            </div>

            {/* Album grid */}
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 mb-2">
              {playlistResult.songs.map((song, index) => {
                const isSelected = selectedSong?.spotify_id === song.spotify_id
                const myRating = feedback[song.spotify_id] || 0
                return (
                  <button
                    key={song.spotify_id}
                    onClick={() => setSelectedSong(isSelected ? null : song)}
                    className={`relative group aspect-square rounded-xl overflow-hidden transition-all duration-200 focus:outline-none ${
                      isSelected ? 'ring-2 ring-green-400 scale-95' : 'opacity-70 hover:opacity-100 hover:scale-95'
                    }`}
                  >
                    {song.album_image ? (
                      <img src={song.album_image} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gray-800 flex items-center justify-center text-gray-600 text-2xl">♪</div>
                    )}

                    <div className="absolute top-1.5 left-1.5">
                      <span className="text-xs font-bold text-white/70 bg-black/50 rounded px-1">{index + 1}</span>
                    </div>

                    <div className={`absolute top-1.5 right-1.5 flex gap-1 transition-opacity duration-150 ${myRating !== 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                      <button
                        onClick={(e) => handleFeedback(song, 1, e)}
                        aria-label="Love this"
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                          myRating === 1 ? 'bg-green-500 text-white' : 'bg-black/60 text-white/70 hover:bg-green-500/80'
                        }`}
                      >↑</button>
                      <button
                        onClick={(e) => handleFeedback(song, -1, e)}
                        aria-label="Not for me"
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                          myRating === -1 ? 'bg-red-500 text-white' : 'bg-black/60 text-white/70 hover:bg-red-500/80'
                        }`}
                      >↓</button>
                    </div>

                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end p-2">
                      <div className="min-w-0">
                        <p className="text-white text-xs font-semibold leading-tight truncate">{song.name}</p>
                        <p className="text-gray-300 text-xs truncate">{song.artist}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            <p className="text-gray-700 text-xs mb-6 text-center">Click an album to hear it and see why we picked it</p>

            {/* Detail panel */}
            <div
              ref={detailRef}
              className={`transition-all duration-500 ease-in-out overflow-hidden ${
                selectedSong && detailVisible ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'
              }`}
            >
              {selectedSong && (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  <div className="flex gap-5 p-6">
                    <div className="flex-shrink-0">
                      {selectedSong.album_image ? (
                        <img src={selectedSong.album_image} alt="" className="w-28 h-28 sm:w-36 sm:h-36 rounded-xl object-cover" />
                      ) : (
                        <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-xl bg-gray-800 flex items-center justify-center text-gray-600 text-4xl">♪</div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="min-w-0">
                          <h3 className="text-white text-xl font-bold leading-tight">{selectedSong.name}</h3>
                          <p className="text-gray-400 mt-0.5">
                            {selectedSong.artist}
                            {selectedSong.year && <span className="text-gray-600"> · {selectedSong.year}</span>}
                          </p>
                          {selectedSong.album_name && <p className="text-gray-600 text-xs mt-0.5 italic truncate">{selectedSong.album_name}</p>}
                        </div>
                        <button onClick={() => setSelectedSong(null)} aria-label="Close" className="text-gray-600 hover:text-gray-400 transition-colors text-lg flex-shrink-0">✕</button>
                      </div>

                      {selectedSong.reason && (
                        <div>
                          <p className="text-green-400 text-xs font-semibold uppercase tracking-widest mb-2">Why we chose it for you</p>
                          <p className="text-gray-300 text-sm leading-relaxed">{selectedSong.reason}</p>
                        </div>
                      )}

                      <div className="mt-4 flex gap-2 items-center flex-wrap">
                        {selectedSong.external_url && (
                          <a href={selectedSong.external_url} target="_blank" rel="noopener noreferrer"
                            className="px-4 py-2 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors font-medium text-xs">
                            Open in Spotify →
                          </a>
                        )}
                        <button
                          onClick={(e) => handleFeedback(selectedSong, 1, e)}
                          className={`px-3 py-2 rounded-full text-xs font-medium transition-colors ${
                            (feedback[selectedSong.spotify_id] || 0) === 1
                              ? 'bg-green-600/30 text-green-400'
                              : 'bg-white/5 text-gray-400 hover:bg-green-600/20 hover:text-green-400'
                          }`}
                        >↑ Love it</button>
                        <button
                          onClick={(e) => handleFeedback(selectedSong, -1, e)}
                          className={`px-3 py-2 rounded-full text-xs font-medium transition-colors ${
                            (feedback[selectedSong.spotify_id] || 0) === -1
                              ? 'bg-red-900/30 text-red-400'
                              : 'bg-white/5 text-gray-400 hover:bg-red-900/20 hover:text-red-400'
                          }`}
                        >↓ Not for me</button>
                      </div>
                    </div>
                  </div>

                  <div className="px-6 pb-6">
                    <iframe
                      key={selectedSong.spotify_id}
                      src={`https://open.spotify.com/embed/track/${selectedSong.spotify_id}?utm_source=generator&theme=0`}
                      width="100%" height="80" frameBorder="0"
                      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                      loading="lazy" className="rounded-xl"
                      title={`${selectedSong.name} by ${selectedSong.artist}`}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

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
