'use client'

import { useEffect, useState } from 'react'
import { useUser, SignInButton, SignOutButton } from '@clerk/nextjs'

interface Song {
  name: string
  artist: string
  spotify_id: string
  preview_url?: string
  external_url: string
  popularity: number
  year?: number
  reason?: string
}

interface PlaylistResult {
  success: boolean
  message: string
  prompt: string
  songs: Song[]
  playlist_id?: string
  playlist_url?: string
  share_url?: string
}

const LOADING_MESSAGES = [
  'Digging through the crates...',
  'Following the thread...',
  "Making connections you won't expect...",
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
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}

async function generateCodeChallenge(verifier: string) {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export default function HomePage() {
  const { isLoaded, isSignedIn, user } = useUser()
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0])
  const [playlistResult, setPlaylistResult] = useState<PlaylistResult | null>(null)
  const [showPaywall, setShowPaywall] = useState(false)

  // Check for Spotify token in localStorage
  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (token) setSpotifyToken(token)
  }, [])

  // Cycle loading messages
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

  const handleConnectSpotify = async () => {
    localStorage.removeItem('code_verifier')
    localStorage.removeItem('access_token')
    const verifier = await generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    localStorage.setItem('code_verifier', verifier)
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: '2ee0d98b21d048978bf73d78924daf91',
      scope: 'user-read-private user-read-email playlist-modify-public playlist-modify-private user-read-recently-played user-top-read',
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

    try {
      const response = await fetch('/api/generate-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, access_token: spotifyToken }),
      })

      const data = await response.json()

      if (data.paywall) {
        setShowPaywall(true)
        return
      }
      if (!response.ok) {
        alert('Error: ' + (data.error || data.message || 'Unknown error'))
        return
      }
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

  // Loading state while Clerk initialises
  if (!isLoaded) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gray-950">
        <div className="flex space-x-1">
          {[0,1,2].map(i => (
            <div key={i} className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    )
  }

  // Not signed in — show landing / sign-in
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

  // Signed in but Spotify not connected
  if (!spotifyToken) {
    return (
      <main className="h-screen w-screen flex items-center justify-center bg-gray-950">
        <div className="text-center max-w-md px-6">
          <p className="text-green-400 text-sm mb-2">Hey {user.firstName || user.username} 👋</p>
          <h1 className="text-3xl font-bold text-white mb-4">Connect your Spotify</h1>
          <p className="text-gray-400 mb-8">We&apos;ll read your listening history to find music you haven&apos;t heard yet — not more of the same.</p>
          <button
            onClick={handleConnectSpotify}
            className="px-8 py-4 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors font-semibold"
          >
            Connect Spotify
          </button>
          <div className="mt-6">
            <SignOutButton>
              <button className="text-gray-600 text-sm hover:text-gray-400 transition-colors">Sign out</button>
            </SignOutButton>
          </div>
        </div>
      </main>
    )
  }

  // Fully authenticated — main app
  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex justify-between items-center mb-10">
          <div>
            <p className="text-green-400 text-sm font-medium tracking-widest uppercase">algorithmssuck.com</p>
            <p className="text-gray-500 text-sm">{user.primaryEmailAddress?.emailAddress}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleDisconnectSpotify}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              Disconnect Spotify
            </button>
            <SignOutButton>
              <button className="text-xs text-gray-500 hover:text-gray-300 bg-white/5 px-3 py-1.5 rounded-full transition-colors">
                Sign out
              </button>
            </SignOutButton>
          </div>
        </div>

        {/* Prompt box */}
        <div className="mb-6">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGeneratePlaylist() }}
            placeholder="Describe a vibe, a moment, a feeling, a time period, a genre you half-remember... anything."
            className="w-full p-5 bg-gray-900 border border-gray-800 rounded-2xl text-white placeholder-gray-600 focus:outline-none focus:border-green-700 resize-none text-base"
            rows={4}
          />
        </div>

        <button
          onClick={handleGeneratePlaylist}
          disabled={isLoading || !prompt.trim()}
          className="w-full py-4 bg-green-600 text-white rounded-2xl hover:bg-green-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors font-semibold text-base"
        >
          Find my music
        </button>

        {/* Loading */}
        {isLoading && (
          <div className="mt-8 p-8 bg-gray-900 rounded-2xl text-center">
            <div className="flex justify-center mb-4 gap-1">
              {[0,1,2,3,4].map(i => (
                <div
                  key={i}
                  className="w-1.5 bg-green-400 rounded-full animate-bounce"
                  style={{ height: `${16 + (i % 3) * 8}px`, animationDelay: `${i * 0.1}s` }}
                />
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
              <button className="px-6 py-3 bg-green-600 text-white rounded-full font-semibold hover:bg-green-500 transition-colors">
                Subscribe — $4.99/month
              </button>
              <button className="px-6 py-3 bg-white/10 text-white rounded-full font-semibold hover:bg-white/20 transition-colors">
                Buy credits — 10 for $3
              </button>
            </div>
            <p className="text-gray-600 text-xs mt-4">Payments coming very soon.</p>
          </div>
        )}

        {/* Playlist result */}
        {playlistResult && (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-gray-500 text-sm italic">&ldquo;{playlistResult.prompt}&rdquo;</p>
              </div>
            </div>

            <div className="flex gap-3 mb-6 flex-wrap">
              {playlistResult.playlist_url && (
                <a
                  href={playlistResult.playlist_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors font-medium text-sm"
                >
                  Open in Spotify →
                </a>
              )}
              {playlistResult.share_url && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(playlistResult.share_url || '')
                    const btn = document.getElementById('copy-btn')
                    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy share link' }, 2000) }
                  }}
                  id="copy-btn"
                  className="px-5 py-2.5 bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors font-medium text-sm"
                >
                  Copy share link
                </button>
              )}
              <button
                onClick={() => setPlaylistResult(null)}
                className="px-5 py-2.5 text-gray-600 hover:text-gray-400 transition-colors text-sm"
              >
                Clear
              </button>
            </div>

            <div className="space-y-1">
              {playlistResult.songs.map((song, index) => (
                <div key={index} className="flex items-start gap-4 p-3 rounded-xl hover:bg-white/5 transition-colors group">
                  <span className="text-gray-700 text-sm w-5 text-right font-mono pt-0.5 flex-shrink-0">{index + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-medium text-white">{song.name}</span>
                      {song.year && <span className="text-gray-600 text-xs">{song.year}</span>}
                      {song.popularity !== undefined && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          song.popularity < 30 ? 'bg-red-900/50 text-red-400' :
                          song.popularity < 50 ? 'bg-yellow-900/50 text-yellow-400' :
                          'bg-gray-800 text-gray-500'
                        }`}>
                          {song.popularity < 30 ? 'Very Obscure' : song.popularity < 50 ? 'Hidden Gem' : song.popularity < 70 ? 'Lesser Known' : 'Popular'}
                        </span>
                      )}
                    </div>
                    <p className="text-gray-400 text-sm">{song.artist}</p>
                    {song.reason && <p className="text-gray-600 text-xs mt-1 italic">{song.reason}</p>}
                  </div>
                  {song.external_url && (
                    <a
                      href={song.external_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-700 hover:text-green-400 text-xs opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 pt-0.5"
                    >
                      Play →
                    </a>
                  )}
                </div>
              ))}
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
                'Music that sounds like it was made in a city you\'ve never visited',
                'Sad but not wallowing — getting through it',
                'The opening scene of a film you haven\'t seen yet',
              ].map((example, i) => (
                <button
                  key={i}
                  onClick={() => setPrompt(example)}
                  className="block w-full text-left px-4 py-3 text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-xl transition-colors text-sm"
                >
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
