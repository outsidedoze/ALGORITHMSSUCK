'use client'

import { useEffect, useState } from 'react'

function generateCodeVerifier(length = 128) {
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

async function handleLogin() {
  // Clear any existing code_verifier to prevent conflicts
  localStorage.removeItem('code_verifier')
  localStorage.removeItem('access_token')
  
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)

  localStorage.setItem('code_verifier', verifier)
  console.log('Stored code verifier:', verifier)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: '2ee0d98b21d048978bf73d78924daf91',
    scope: 'user-read-private user-read-email playlist-modify-public playlist-modify-private user-read-recently-played user-top-read',
    redirect_uri: 'http://localhost:3000/callback',
    code_challenge_method: 'S256',
    code_challenge: challenge,
  })

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`
}

export default function HomePage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [userProfile, setUserProfile] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [playlistResult, setPlaylistResult] = useState(null)

  useEffect(() => {
    const accessToken = localStorage.getItem('access_token')
    if (accessToken) {
      setIsAuthenticated(true)
      // Fetch user profile
      fetch('http://127.0.0.1:5000/me', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: accessToken }),
      })
        .then(res => res.json())
        .then(data => {
          if (data.id) {
            setUserProfile(data)
          }
        })
        .catch(err => console.error('Error fetching profile:', err))
    }
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('code_verifier')
    setIsAuthenticated(false)
    setUserProfile(null)
  }

  const handleGeneratePlaylist = async () => {
    if (!prompt.trim()) return

    setIsLoading(true)
    const accessToken = localStorage.getItem('access_token')

    try {
      const response = await fetch('http://127.0.0.1:5000/generate-playlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt,
          access_token: accessToken,
        }),
      })

      const data = await response.json()
      console.log('Playlist generation response:', data)
      if (!response.ok) {
        alert('Error generating playlist: ' + (data.error || data.message || response.statusText || 'Unknown error'))
        return
      }
      if (data.success) {
        setPlaylistResult(data)
        setPrompt('') // Clear the prompt after successful generation
      } else {
        alert('Error generating playlist: ' + (data.error || data.message || 'Unknown error'))
      }
    } catch (error) {
      console.error('Error generating playlist:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <main className="h-screen w-screen flex items-center justify-center bg-gradient-to-br from-green-400 to-blue-500">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-8">Playlist Genius</h1>
          <p className="text-white mb-8 text-lg">Create amazing playlists with AI</p>
          <button onClick={handleLogin} className="bg-green-500 text-white px-8 py-4 rounded-lg hover:bg-green-600 text-lg font-semibold transition-colors">
            Connect to Spotify
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-green-400 to-blue-500 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Playlist Genius</h1>
            {userProfile && (
              <p className="text-white opacity-90">Welcome, {userProfile.display_name}!</p>
            )}
          </div>
          <button 
            onClick={handleLogout}
            className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors"
          >
            Logout
          </button>
        </div>

        {/* Main Content */}
        <div className="bg-white rounded-lg p-8 shadow-lg">
          <h2 className="text-2xl font-semibold mb-6 text-gray-800">Generate Your Playlist</h2>
          
          <div className="space-y-6">
            <div>
              <label htmlFor="prompt" className="block text-sm font-medium text-gray-700 mb-2">
                Describe the playlist you want:
              </label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g., 'A high-energy workout playlist with rock and electronic music' or 'Chill vibes for studying with lo-fi and ambient sounds'"
                className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
                rows={4}
              />
            </div>

            <button
              onClick={handleGeneratePlaylist}
              disabled={isLoading || !prompt.trim()}
              className="w-full bg-green-500 text-white py-3 px-6 rounded-lg hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-semibold"
            >
              {isLoading ? 'Generating Playlist...' : 'Generate Playlist'}
            </button>
          </div>

          {/* Example prompts */}
          <div className="mt-8">
            <h3 className="text-lg font-medium text-gray-800 mb-4">Example prompts:</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">"Upbeat pop songs for a road trip with friends"</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">"Relaxing acoustic music for a cozy evening"</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">"High-energy EDM for a workout session"</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">"Classic rock hits from the 70s and 80s"</p>
              </div>
            </div>
                     </div>

           {/* Playlist Result */}
           {playlistResult && (
             <div className="mt-8 p-6 bg-green-50 border border-green-200 rounded-lg">
               <h3 className="text-lg font-semibold text-green-800 mb-4">Generated Playlist</h3>
               <p className="text-green-700 mb-4">
                 <strong>Prompt:</strong> {playlistResult.prompt}
               </p>
               
               {/* Playlist Link */}
               {playlistResult.playlist_url && (
                 <div className="mb-4 p-4 bg-white rounded border">
                   <h4 className="font-medium text-green-800 mb-2">🎵 Your Playlist Has Been Created!</h4>
                   <a
                     href={playlistResult.playlist_url}
                     target="_blank"
                     rel="noopener noreferrer"
                     className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                   >
                     Open Playlist in Spotify →
                   </a>
                 </div>
               )}
               
               <div className="space-y-2">
                 <h4 className="font-medium text-green-800">Songs Added:</h4>
                 {playlistResult.songs.map((song, index) => (
                   <div key={index} className="flex justify-between items-center p-3 bg-white rounded border hover:bg-gray-50 transition-colors">
                     <div className="flex-1">
                       <span className="font-medium text-gray-900">{song.name}</span>
                       {song.year !== undefined && song.year !== null && (
                         <span className="text-gray-500 ml-2">({song.year})</span>
                       )}
                       <span className="text-gray-600 ml-2">by {song.artist}</span>
                       {song.popularity !== undefined && (
                         <div className="mt-1">
                           <span className={`text-xs px-2 py-1 rounded ${
                             song.popularity < 30 ? 'bg-red-100 text-red-800' :
                             song.popularity < 50 ? 'bg-yellow-100 text-yellow-800' :
                             song.popularity < 70 ? 'bg-blue-100 text-blue-800' :
                             'bg-gray-100 text-gray-800'
                           }`}>
                             {song.popularity < 30 ? '🔥 Very Obscure' :
                              song.popularity < 50 ? '💎 Hidden Gem' :
                              song.popularity < 70 ? '⭐ Lesser Known' :
                              '📻 Popular'}
                           </span>
                         </div>
                       )}
                       {song.chatgpt_reason && (
                         <div className="mt-1">
                           <span className="text-xs text-gray-600 italic">
                             🤖 {song.chatgpt_reason}
                           </span>
                         </div>
                       )}
                     </div>
                     {song.external_url && (
                       <a
                         href={song.external_url}
                         target="_blank"
                         rel="noopener noreferrer"
                         className="text-green-600 hover:text-green-800 font-medium text-sm"
                       >
                         Open in Spotify →
                       </a>
                     )}
                   </div>
                 ))}
               </div>
               <button
                 onClick={() => setPlaylistResult(null)}
                 className="mt-4 text-green-600 hover:text-green-800 underline"
               >
                 Clear Result
               </button>
             </div>
           )}
         </div>
       </div>
     </main>
   )
}