import { supabase, generateShareId } from '@/lib/supabase'
import { auth } from '@clerk/nextjs/server'

export async function POST(request) {
  try {
    const { userId: clerkUserId } = await auth()
    if (!clerkUserId) {
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 })
    }

    const data = await request.json()
    const {
      prompt,
      access_token,
      mode_slider = 50,       // 0 = strict genre, 100 = pure vibe
      era_slider = 50,        // 0 = vintage only, 100 = modern only
      obscurity_slider = 75,  // 0 = familiar anchors ok, 100 = deep cuts only
    } = data

    if (!prompt || !access_token) {
      return Response.json({ error: 'Missing required fields', success: false }, { status: 400 })
    }

    // Get Spotify user profile
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    })
    if (!userResponse.ok) {
      const isExpired = userResponse.status === 401
      return Response.json({
        success: false,
        token_expired: isExpired,
        error: isExpired ? 'spotify_token_expired' : 'Failed to get user profile'
      }, { status: 401 })
    }
    const userProfile = await userResponse.json()
    const spotifyUserId = userProfile.id
    const userEmail = userProfile.email || ''

    // Admin check
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase())
    const isAdmin = adminEmails.includes(userEmail.toLowerCase())

    // Freemium gate
    const freeLimit = parseInt(process.env.FREE_PLAYLIST_LIMIT || '3', 10)
    if (!isAdmin) {
      const { data: userRecord, error: upsertError } = await supabase
        .from('users')
        .upsert({ id: clerkUserId, email: userEmail }, { onConflict: 'id' })
        .select('playlist_count, is_subscribed, credits')
        .single()

      if (!upsertError && userRecord) {
        const hasSubscription = userRecord.is_subscribed
        const paidCredits = userRecord.credits || 0
        const freeUsed = userRecord.playlist_count || 0
        const freeRemaining = Math.max(0, freeLimit - freeUsed)

        if (!hasSubscription && paidCredits === 0 && freeRemaining === 0) {
          return Response.json({
            success: false,
            paywall: true,
            message: `You've used your ${freeLimit} free playlists. Subscribe for unlimited or buy a credit pack.`,
            playlists_used: freeUsed,
            free_limit: freeLimit,
          }, { status: 402 })
        }
      }
    }

    // ── Fetch all Spotify data in parallel ─────────────────────────────
    const [
      recentRes,
      topTracksShortRes,
      topTracksMedRes,
      topTracksLongRes,
      topArtistsShortRes,
      topArtistsMedRes,
      topArtistsLongRes,
      likedTracksRes,
    ] = await Promise.all([
      fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      }),
      fetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=short_term', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      }),
      fetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      }),
      fetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=long_term', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      }),
      fetch('https://api.spotify.com/v1/me/top/artists?limit=20&time_range=short_term', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      }),
      fetch('https://api.spotify.com/v1/me/top/artists?limit=20&time_range=medium_term', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      }),
      fetch('https://api.spotify.com/v1/me/top/artists?limit=20&time_range=long_term', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      }),
      fetch('https://api.spotify.com/v1/me/tracks?limit=50', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      }),
    ])

    const avoidSongIds = new Set()
    const avoidArtistNames = new Set()

    // Recently played
    if (recentRes.ok) {
      const d = await recentRes.json()
      d.items.forEach(item => {
        avoidSongIds.add(item.track.id)
        avoidArtistNames.add(item.track.artists[0].name)
      })
    }

    // Top tracks — all three ranges (build avoid list + get long-term IDs for audio features)
    let longTermTrackIds = []
    for (const [res, isLong] of [[topTracksShortRes, false], [topTracksMedRes, false], [topTracksLongRes, true]]) {
      if (res.ok) {
        const d = await res.json()
        d.items.forEach(t => {
          avoidSongIds.add(t.id)
          avoidArtistNames.add(t.artists[0].name)
          if (isLong) longTermTrackIds.push(t.id)
        })
      }
    }

    // Top artists — build weighted taste profile
    // long_term weighted most heavily (true taste), medium second, short third
    const artistWeights = new Map() // name → weight
    const processArtists = (res, weight) => {
      if (!res.ok) return []
      return res.json().then(d => {
        d.items.forEach((a, idx) => {
          const current = artistWeights.get(a.name) || 0
          artistWeights.set(a.name, current + weight * (1 - idx / d.items.length))
          avoidArtistNames.add(a.name)
        })
        return d.items
      })
    }

    const [artistsShort, artistsMed, artistsLong] = await Promise.all([
      processArtists(topArtistsShortRes, 1),
      processArtists(topArtistsMedRes, 2),
      processArtists(topArtistsLongRes, 3),
    ])

    // Sort by weight — these are the listener's TRUE taste
    const weightedArtists = [...artistWeights.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)

    // Liked/saved tracks
    let likedArtists = []
    let likedTrackNames = []
    if (likedTracksRes.ok) {
      const d = await likedTracksRes.json()
      d.items.slice(0, 20).forEach(({ track }) => {
        likedArtists.push(track.artists[0].name)
        likedTrackNames.push(`${track.name} by ${track.artists[0].name}`)
        avoidSongIds.add(track.id)
        avoidArtistNames.add(track.artists[0].name)
      })
    }

    // Audio features for long-term top tracks
    let audioProfile = null
    if (longTermTrackIds.length > 0) {
      const idsParam = longTermTrackIds.slice(0, 100).join(',')
      const featuresRes = await fetch(
        `https://api.spotify.com/v1/audio-features?ids=${idsParam}`,
        { headers: { 'Authorization': `Bearer ${access_token}` } }
      )
      if (featuresRes.ok) {
        const featData = await featuresRes.json()
        const features = (featData.audio_features || []).filter(Boolean)
        if (features.length > 0) {
          const avg = (key) => features.reduce((s, f) => s + (f[key] || 0), 0) / features.length
          audioProfile = {
            energy: avg('energy').toFixed(2),
            valence: avg('valence').toFixed(2),
            danceability: avg('danceability').toFixed(2),
            acousticness: avg('acousticness').toFixed(2),
            instrumentalness: avg('instrumentalness').toFixed(2),
            tempo: Math.round(avg('tempo')),
          }
        }
      }
    }

    // ── Fetch feedback history from Supabase ────────────────────────────
    let lovedArtists = []
    let rejectedArtists = []
    let lovedTracks = []
    let rejectedTracks = []

    const { data: feedbackHistory } = await supabase
      .from('track_feedback')
      .select('artist_name, track_name, rating')
      .eq('user_id', clerkUserId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (feedbackHistory && feedbackHistory.length > 0) {
      const loved = feedbackHistory.filter(f => f.rating === 1)
      const rejected = feedbackHistory.filter(f => f.rating === -1)

      // Unique artists from feedback
      lovedArtists = [...new Set(loved.map(f => f.artist_name).filter(Boolean))].slice(0, 15)
      rejectedArtists = [...new Set(rejected.map(f => f.artist_name).filter(Boolean))].slice(0, 15)
      lovedTracks = loved.map(f => `${f.track_name} by ${f.artist_name}`).slice(0, 10)
      rejectedTracks = rejected.map(f => `${f.track_name} by ${f.artist_name}`).slice(0, 10)

      // Never suggest rejected artists
      rejectedArtists.forEach(a => avoidArtistNames.add(a))
    }

    // ── Translate sliders to prompt instructions ─────────────────────────
    const getModeInstruction = (val) => {
      if (val <= 20) return 'GENRE-STRICT: The listener has requested precise genre accuracy. Every single track must be squarely within the named genre or subgenre. No exceptions.'
      if (val <= 40) return 'GENRE-LEANING: Stay close to the named genre. Minor crossovers into adjacent styles are acceptable if the connection is obvious and the feel is right.'
      if (val <= 60) return 'BALANCED: Mix genre precision with emotional/vibe connections. Some tracks can be genre-adjacent if they serve the overall feeling.'
      if (val <= 80) return 'VIBE-LEANING: Prioritise the emotional feel over strict genre. Cross genre lines freely when the vibe matches.'
      return 'PURE VIBE: Ignore genre entirely. Follow the emotional thread wherever it leads across decades, continents, and styles.'
    }

    const getEraInstruction = (val) => {
      if (val <= 20) return 'ERA: Focus on vintage/classic recordings. Prioritise pre-1990s material. Modern tracks only if truly essential.'
      if (val <= 40) return 'ERA: Lean toward classic and older recordings (pre-2000s), with some modern gems allowed.'
      if (val <= 60) return 'ERA: Span all eras freely — mix classic recordings with contemporary ones.'
      if (val <= 80) return 'ERA: Lean toward modern (post-2000s), but include some classic touchstones for depth.'
      return 'ERA: Prioritise contemporary music (post-2010). Include older tracks only if they feel fresh or culturally essential.'
    }

    const getObscurityInstruction = (val) => {
      if (val <= 20) return 'OBSCURITY: Include well-known classics alongside discoveries. The listener wants some familiar anchors.'
      if (val <= 40) return 'OBSCURITY: Mix of known and unknown — roughly half should be recognisable to an engaged music fan.'
      if (val <= 60) return 'OBSCURITY: Lean toward overlooked and underrated, but a few well-regarded classics are fine.'
      if (val <= 80) return 'OBSCURITY: Mostly deep cuts, cult records, and regional scenes. Mainstream picks should be rare and exceptional.'
      return 'OBSCURITY: Deep cuts only. Every track should be something the average music fan — even an engaged one — has never encountered. No mainstream picks.'
    }

    // ── Build audio fingerprint description ─────────────────────────────
    const describeAudio = (profile) => {
      if (!profile) return 'Audio profile: not available'
      const energyDesc = profile.energy > 0.7 ? 'high energy' : profile.energy > 0.4 ? 'mid energy' : 'low energy'
      const valenceDesc = profile.valence > 0.6 ? 'upbeat/positive' : profile.valence > 0.35 ? 'mixed/neutral' : 'melancholic/dark'
      const danceDesc = profile.danceability > 0.7 ? 'very danceable' : profile.danceability > 0.45 ? 'moderately groovy' : 'non-dance oriented'
      const acousticDesc = profile.acousticness > 0.5 ? 'strongly acoustic' : profile.acousticness > 0.2 ? 'mixed acoustic/electronic' : 'electronic/produced'
      const instrDesc = profile.instrumentalness > 0.4 ? 'prefers instrumental' : 'prefers vocals'
      return `${energyDesc} · ${valenceDesc} · ${danceDesc} · ${acousticDesc} · ${instrDesc} · avg tempo ${profile.tempo} BPM`
    }

    // ── System prompt ────────────────────────────────────────────────────
    const systemPrompt = `You are a world-class music curator — not an algorithm, not a recommendation engine. You are the rare human being who has spent their entire life obsessively immersed in music across every genre, era, country, and subculture. Your reputation is built on two things: encyclopedic knowledge and genuine taste.

You think the way a legendary DJ thinks when they're reading a room. The way a great A&R exec thinks when they hear a demo. The way the best record store clerk thinks when they look at someone's purchases and say "wait, have you heard this?" and hand you something that changes your life.

YOUR PHILOSOPHY:
The best recommendation is not always the most obvious one. Sometimes it's the left-field pick — the one the listener wouldn't predict but will immediately feel is right. Like a friend saying "trust me on this one" and being completely correct. You are a tastemaker. You make curatorial decisions based on deep musical knowledge, not just pattern-matching. The unexpected connection that lands perfectly is always better than the safe, obvious pick.

But your credibility depends on being RIGHT. Every suggestion must be grounded in real musical understanding — not guesswork. When you make a bold pick, it's because you genuinely know it will land. Not because you're being random.

HOW YOU BUILD THIS PLAYLIST:

STEP 1 — READ THE LISTENER'S MUSICAL DNA:
Study every signal you've been given. The weighted artist profile shows who they truly are (long-term = deep identity, short-term = current phase). The audio fingerprint quantifies their natural instincts — tempo, energy, emotional register, acoustic vs. electronic. Their liked tracks are the strongest signal of all: these are songs they deliberately saved. Their feedback history tells you what landed and what didn't.

STEP 2 — UNDERSTAND THE REQUEST:
Detect whether this is a genre request or a vibe/mood request, then apply the specific mode instruction you've been given.

STEP 3 — BUILD WITH INTENTION:
Find 20 songs that sit at the perfect intersection of who this person is and what they're asking for — but that they have genuinely never heard. Span subgenres, eras, and geographies within the emotional or genre space. Sequence the playlist with arc and intention — it should feel like it was curated, not shuffled.

THE STANDARD:
- Every track should feel like a revelation
- The playlist flows — it has shape, momentum, intention
- Pull from overlooked classics, regional scenes, international artists, cult records, deep catalog cuts
- The tastemaker's instinct matters: sometimes the right pick is the one no algorithm would suggest

ANTI-HALLUCINATION — non-negotiable:
You only include songs you are 100% certain exist on Spotify. If you have ANY doubt about whether a specific song by a specific artist is on Spotify — skip it and choose something you are certain of. A playlist of 20 verified tracks beats one with invented ones every time.

HARD RULES:
- Exactly 20 songs
- Never include any artist from their known rotation or reject list
- Never repeat artists within the playlist
- If a time period is mentioned, be strict
- Playlist title: sharp, specific, evocative — earns the click

Return valid JSON only, no markdown, no other text:
{"title": "Playlist Title Here", "songs": [{"name": "Song Name", "artist": "Artist Name", "reason": "Specific musical reason — name the era, scene, or sonic quality and why it's right for this listener"}]}`

    // ── User prompt ───────────────────────────────────────────────────────
    const userPrompt = `LISTENER'S TASTE PROFILE:

Top artists by true weight (long-term preference signals most heavily):
${weightedArtists.slice(0, 20).join(', ') || 'Not available'}

Songs/artists they've deliberately saved (strong love signals):
${likedTrackNames.slice(0, 10).join(' | ') || 'None available'}

${audioProfile ? `AUDIO FINGERPRINT (computed from their long-term top tracks):
${describeAudio(audioProfile)}
Raw: energy ${audioProfile.energy}, valence ${audioProfile.valence}, danceability ${audioProfile.danceability}, acousticness ${audioProfile.acousticness}, instrumentalness ${audioProfile.instrumentalness}, tempo ${audioProfile.tempo} BPM` : ''}

${lovedArtists.length > 0 ? `FEEDBACK — they have explicitly LOVED suggestions of: ${lovedArtists.join(', ')}` : ''}
${lovedTracks.length > 0 ? `Specific tracks they loved: ${lovedTracks.join(' | ')}` : ''}
${rejectedArtists.length > 0 ? `FEEDBACK — they have REJECTED suggestions of: ${rejectedArtists.join(', ')} — avoid these artists and anything sonically similar` : ''}

ARTISTS TO AVOID (already in their world):
${Array.from(avoidArtistNames).slice(0, 50).join(', ')}

GENERATION SETTINGS:
${getModeInstruction(mode_slider)}
${getEraInstruction(era_slider)}
${getObscurityInstruction(obscurity_slider)}

THEIR REQUEST: "${prompt}"

Read the taste profile carefully. Understand who this person is. Then build 20 tracks that will feel like a revelation — grounded in their DNA but taking them somewhere new. Return JSON only.`

    // ── Call Claude Sonnet ───────────────────────────────────────────────
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    })

    let claudeSongs = []
    let aiTitle = null

    if (anthropicResponse.ok) {
      const anthropicData = await anthropicResponse.json()
      const rawText = anthropicData.content[0].text
      console.log('Claude raw response:', rawText)
      try {
        const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        const parsed = JSON.parse(jsonText)
        claudeSongs = parsed.songs || []
        aiTitle = parsed.title || null
      } catch (e) {
        console.log('Failed to parse Claude response:', e.message)
      }
    } else {
      const errorText = await anthropicResponse.text()
      console.log('Anthropic API error:', anthropicResponse.status, errorText)
    }

    // ── Search Spotify ───────────────────────────────────────────────────
    const searchPromises = claudeSongs.slice(0, 20).map(async (song) => {
      try {
        const extractTrack = (items) => {
          if (!items || items.length === 0) return null
          const track = items.find(t => !avoidSongIds.has(t.id)) || items[0]
          if (avoidSongIds.has(track.id)) return null
          return {
            name: track.name,
            artist: track.artists[0].name,
            spotify_id: track.id,
            preview_url: track.preview_url,
            external_url: track.external_urls.spotify,
            popularity: track.popularity,
            year: track.album.release_date
              ? new Date(track.album.release_date).getFullYear()
              : null,
            album_image: track.album.images?.[1]?.url || track.album.images?.[0]?.url || null,
            album_name: track.album.name || null,
            reason: song.reason
          }
        }

        const strictQuery = encodeURIComponent(`track:${song.name} artist:${song.artist}`)
        const strictRes = await fetch(
          `https://api.spotify.com/v1/search?q=${strictQuery}&type=track&limit=3`,
          { headers: { 'Authorization': `Bearer ${access_token}` } }
        )
        if (strictRes.ok) {
          const d = await strictRes.json()
          const result = extractTrack(d.tracks.items)
          if (result) return result
        }

        const looseQuery = encodeURIComponent(`${song.name} ${song.artist}`)
        const looseRes = await fetch(
          `https://api.spotify.com/v1/search?q=${looseQuery}&type=track&limit=5`,
          { headers: { 'Authorization': `Bearer ${access_token}` } }
        )
        if (looseRes.ok) {
          const d = await looseRes.json()
          return extractTrack(d.tracks.items)
        }
      } catch (err) {
        console.error('Error searching song:', song, err)
      }
      return null
    })

    const foundSongs = (await Promise.all(searchPromises)).filter(Boolean)

    if (foundSongs.length === 0) {
      return Response.json({ success: false, message: 'No songs found for your prompt', prompt, songs: [] })
    }
    if (foundSongs.length < 5) {
      return Response.json({ success: false, message: `Only found ${foundSongs.length} songs — need at least 5`, prompt, songs: foundSongs })
    }

    // ── Create Spotify playlist ──────────────────────────────────────────
    const playlistName = aiTitle || `Discovery: ${prompt.slice(0, 40)}`

    const createRes = await fetch(`https://api.spotify.com/v1/me/playlists`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: playlistName,
        description: '🎵 Curated by AI — all new music, zero algorithm',
        public: false
      })
    })

    if (!createRes.ok) {
      const err = await createRes.text()
      return Response.json({ success: false, message: 'Found songs but failed to create playlist', error: err, songs: foundSongs })
    }

    const playlist = await createRes.json()
    const trackUris = foundSongs.map(s => `spotify:track:${s.spotify_id}`)
    await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: trackUris })
    })

    // ── Save to Supabase ─────────────────────────────────────────────────
    let shareUrl = null
    try {
      const shareId = generateShareId()
      const { error: dbError } = await supabase.from('playlists').insert({
        share_id: shareId,
        prompt,
        title: playlistName,
        songs: foundSongs,
        spotify_url: playlist.external_urls.spotify,
        user_id: clerkUserId,
      })
      if (!dbError) {
        shareUrl = `https://www.algorithmssuck.com/playlist/${shareId}`
        if (!isAdmin) {
          await supabase.rpc('increment_playlist_count', { user_id_input: clerkUserId })
        }
      } else {
        console.log('DB save error:', dbError.message)
      }
    } catch (dbErr) {
      console.log('DB save error (non-fatal):', dbErr.message)
    }

    return Response.json({
      success: true,
      message: `Successfully created "${playlistName}" with ${foundSongs.length} songs!`,
      title: playlistName,
      prompt,
      songs: foundSongs,
      playlist_id: playlist.id,
      playlist_url: playlist.external_urls.spotify,
      share_url: shareUrl,
    })

  } catch (error) {
    console.error('Error in generate-playlist:', error)
    return Response.json({ error: 'Internal server error', details: error.message, success: false }, { status: 500 })
  }
}
