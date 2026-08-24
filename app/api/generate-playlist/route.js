import { supabase, generateShareId } from '@/lib/supabase'
import { spotifySearch, normaliseTrack } from '@/lib/spotify'
import { auth, currentUser } from '@clerk/nextjs/server'

export async function POST(request) {
  try {
    const { userId: clerkUserId } = await auth()
    if (!clerkUserId) {
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 })
    }

    const body = await request.json()
    const {
      prompt,
      mode_slider = 50,       // 0 = strict genre, 100 = pure vibe
      era_slider = 50,        // 0 = vintage only, 100 = modern only
      obscurity_slider = 75,  // 0 = familiar anchors, 100 = deep cuts only
    } = body

    if (!prompt || !prompt.trim()) {
      return Response.json({ error: 'Missing prompt', success: false }, { status: 400 })
    }

    // Identity + email come from Clerk now (Spotify no longer exposes email)
    const user = await currentUser()
    const userEmail = user?.emailAddresses?.[0]?.emailAddress || ''

    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    const isAdmin = adminEmails.includes(userEmail.toLowerCase())

    // ── Load user record: taste profile + usage ──────────────────────────
    const { data: userRecord } = await supabase
      .from('users')
      .upsert({ id: clerkUserId, email: userEmail }, { onConflict: 'id' })
      .select('favorite_artists, playlist_count, is_subscribed, credits')
      .single()

    const favoriteArtists = userRecord?.favorite_artists || []

    if (favoriteArtists.length === 0) {
      return Response.json({
        success: false,
        needs_taste: true,
        message: 'Tell us a few artists you love first.',
      }, { status: 400 })
    }

    // ── Freemium gate ────────────────────────────────────────────────────
    const freeLimit = parseInt(process.env.FREE_PLAYLIST_LIMIT || '3', 10)
    if (!isAdmin && userRecord) {
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

    // ── Build the avoid list ─────────────────────────────────────────────
    const avoidArtistNames = new Set(favoriteArtists)

    // Feedback history
    let lovedArtists = []
    let rejectedArtists = []
    let lovedTracks = []

    const { data: feedbackHistory } = await supabase
      .from('track_feedback')
      .select('artist_name, track_name, rating')
      .eq('user_id', clerkUserId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (feedbackHistory?.length) {
      const loved = feedbackHistory.filter(f => f.rating === 1)
      const rejected = feedbackHistory.filter(f => f.rating === -1)
      lovedArtists = [...new Set(loved.map(f => f.artist_name).filter(Boolean))].slice(0, 15)
      rejectedArtists = [...new Set(rejected.map(f => f.artist_name).filter(Boolean))].slice(0, 15)
      lovedTracks = loved.map(f => `${f.track_name} by ${f.artist_name}`).slice(0, 10)
      rejectedArtists.forEach(a => avoidArtistNames.add(a))
    }

    // Artists already suggested in this user's previous playlists — don't repeat
    const { data: pastPlaylists } = await supabase
      .from('playlists')
      .select('songs')
      .eq('user_id', clerkUserId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (pastPlaylists?.length) {
      pastPlaylists.forEach(p => {
        if (Array.isArray(p.songs)) {
          p.songs.forEach(s => { if (s?.artist) avoidArtistNames.add(s.artist) })
        }
      })
    }

    // ── Slider → instruction mapping ─────────────────────────────────────
    const getModeInstruction = (v) => {
      if (v <= 20) return 'GENRE-STRICT: If a genre is named, every single track must sit squarely inside it. No exceptions, no crossovers.'
      if (v <= 40) return 'GENRE-LEANING: Stay close to the named genre. Minor crossovers into adjacent styles are fine when the connection is obvious.'
      if (v <= 60) return 'BALANCED: Mix genre precision with emotional resonance. Genre-adjacent picks are welcome if they serve the feeling.'
      if (v <= 80) return 'VIBE-LEANING: Prioritise emotional feel over genre. Cross genre lines freely when the mood matches.'
      return 'PURE VIBE: Ignore genre entirely. Follow the emotional thread wherever it leads across eras, continents and styles.'
    }

    const getEraInstruction = (v) => {
      if (v <= 20) return 'ERA: Focus on vintage recordings, mostly pre-1990. Modern tracks only when truly essential.'
      if (v <= 40) return 'ERA: Lean toward older recordings (pre-2000), with a few modern gems allowed.'
      if (v <= 60) return 'ERA: Span all eras freely — mix classic recordings with contemporary ones.'
      if (v <= 80) return 'ERA: Lean modern (post-2000), with some classic touchstones for depth.'
      return 'ERA: Prioritise contemporary music (post-2010). Older tracks only if they feel genuinely fresh.'
    }

    const getObscurityInstruction = (v) => {
      if (v <= 20) return 'OBSCURITY: Include well-known classics alongside discoveries — the listener wants familiar anchors.'
      if (v <= 40) return 'OBSCURITY: Roughly half should be recognisable to an engaged music fan.'
      if (v <= 60) return 'OBSCURITY: Lean toward overlooked and underrated, with a few well-regarded classics.'
      if (v <= 80) return 'OBSCURITY: Mostly deep cuts, cult records and regional scenes. Mainstream picks should be rare.'
      return 'OBSCURITY: Deep cuts only. Every track should be something even an engaged music fan has never encountered.'
    }

    // ── Prompts ──────────────────────────────────────────────────────────
    const systemPrompt = `You are a world-class music curator — not an algorithm, not a recommendation engine. You are the rare person who has spent a lifetime obsessively immersed in music across every genre, era, country and subculture. Your reputation rests on two things: encyclopedic knowledge and genuine taste.

You think like a legendary DJ reading a room at 2am. Like an A&R exec hearing a demo. Like the record store clerk who looks at what someone is buying and says "wait — have you heard this?" and hands them the record that changes everything.

YOUR PHILOSOPHY:
The best recommendation is not always the most obvious one. Sometimes it is the left-field pick the listener would never predict but will immediately feel is right. Like a friend saying "trust me on this one" and being completely correct. You are a tastemaker — you make curatorial decisions from deep musical knowledge, not pattern-matching. An unexpected connection that lands is always better than a safe, obvious pick.

But your credibility depends on being RIGHT. When you make a bold pick it is because you genuinely know it will land, not because you are being random.

HOW YOU WORK:

STEP 1 — READ THE LISTENER:
They have told you the artists they love. This is their stated identity, not a play count — it is what they would tell a friend in a record store. Read beneath the names. What production era do they gravitate to? What emotional register? What do they value: rawness, craft, atmosphere, groove, lyricism, strangeness? Their feedback history tells you what has landed before and what has not.

STEP 2 — READ THE REQUEST:
Detect whether they are asking for a genre or a mood, then apply the mode instruction you have been given.

STEP 3 — BUILD WITH INTENTION:
Find 20 songs at the intersection of who this person is and what they are asking for — that they have almost certainly never heard. Span subgenres, eras and geographies within the space. Sequence with arc and momentum. It should feel curated, not shuffled.

ANTI-HALLUCINATION — non-negotiable:
Only include songs you are completely certain exist and are on Spotify. If you have ANY doubt about a specific song by a specific artist, skip it and pick something you are certain of. Twenty verified tracks beats twenty imaginative ones every time.

HARD RULES:
- Exactly 20 songs
- Never include any artist on the avoid list
- Never repeat an artist within the playlist
- If a time period is named, be strict about it
- Playlist title: sharp, specific, evocative — it should earn the click

Return valid JSON only, no markdown, no other text:
{"title": "Playlist Title Here", "songs": [{"name": "Song Name", "artist": "Artist Name", "reason": "Specific musical reason — name the scene, era or sonic quality and why it fits this listener"}]}`

    const userPrompt = `ARTISTS THIS LISTENER LOVES (their stated taste):
${favoriteArtists.join(', ')}

${lovedArtists.length ? `THEY HAVE EXPLICITLY LOVED PAST SUGGESTIONS OF: ${lovedArtists.join(', ')}` : ''}
${lovedTracks.length ? `Specific tracks they loved: ${lovedTracks.join(' | ')}` : ''}
${rejectedArtists.length ? `THEY HAVE REJECTED: ${rejectedArtists.join(', ')} — avoid these and anything sonically similar` : ''}

AVOID ENTIRELY (already known to them, or previously suggested):
${Array.from(avoidArtistNames).slice(0, 60).join(', ')}

GENERATION SETTINGS:
${getModeInstruction(mode_slider)}
${getEraInstruction(era_slider)}
${getObscurityInstruction(obscurity_slider)}

THEIR REQUEST: "${prompt}"

Read the taste profile carefully. Understand who this person is. Then build 20 tracks that will feel like a revelation. Return JSON only.`

    // ── Call Claude ──────────────────────────────────────────────────────
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    let claudeSongs = []
    let aiTitle = null

    if (anthropicResponse.ok) {
      const anthropicData = await anthropicResponse.json()
      const rawText = anthropicData.content?.[0]?.text || ''
      try {
        const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        const parsed = JSON.parse(jsonText)
        claudeSongs = parsed.songs || []
        aiTitle = parsed.title || null
      } catch (e) {
        console.log('Failed to parse Claude response:', e.message, rawText.slice(0, 500))
      }
    } else {
      const errorText = await anthropicResponse.text()
      console.log('Anthropic API error:', anthropicResponse.status, errorText)
      return Response.json({
        success: false,
        message: 'The curator is unavailable right now. Try again in a moment.',
      }, { status: 502 })
    }

    if (claudeSongs.length === 0) {
      return Response.json({ success: false, message: 'Could not generate a playlist. Try rephrasing.' })
    }

    // ── Verify every track exists in the Spotify catalog ─────────────────
    const avoidLower = new Set(Array.from(avoidArtistNames).map(a => a.toLowerCase()))

    const searchPromises = claudeSongs.slice(0, 20).map(async (song) => {
      if (!song?.name || !song?.artist) return null

      const pick = (items) => {
        if (!items?.length) return null
        // Prefer a result whose artist actually matches what Claude claimed
        const target = song.artist.toLowerCase()
        const match = items.find(t =>
          t.artists?.some(a => a.name.toLowerCase().includes(target) || target.includes(a.name.toLowerCase()))
        )
        return match || items[0]
      }

      try {
        // Strict field-filter search first
        const strict = await spotifySearch(`track:${song.name} artist:${song.artist}`, 'track', 5)
        let track = pick(strict?.tracks?.items)

        // Fall back to plain text — more forgiving of punctuation and variants
        if (!track) {
          const loose = await spotifySearch(`${song.name} ${song.artist}`, 'track', 5)
          track = pick(loose?.tracks?.items)
        }

        if (!track) return null

        // Drop anything by an artist on the avoid list
        const artistName = track.artists?.[0]?.name?.toLowerCase() || ''
        if (avoidLower.has(artistName)) return null

        return normaliseTrack(track, song.reason)
      } catch (err) {
        console.error('Search error for', song.name, err.message)
        return null
      }
    })

    let foundSongs = (await Promise.all(searchPromises)).filter(Boolean)

    // De-duplicate by artist and by track id
    const seenArtists = new Set()
    const seenIds = new Set()
    foundSongs = foundSongs.filter(s => {
      const a = s.artist.toLowerCase()
      if (seenArtists.has(a) || seenIds.has(s.spotify_id)) return false
      seenArtists.add(a)
      seenIds.add(s.spotify_id)
      return true
    })

    if (foundSongs.length < 5) {
      return Response.json({
        success: false,
        message: `Only ${foundSongs.length} of the picks could be verified on Spotify. Try again — this usually resolves on a second pass.`,
        songs: foundSongs,
      })
    }

    // ── Save + share link ────────────────────────────────────────────────
    const playlistName = aiTitle || `Discovery: ${prompt.slice(0, 40)}`
    const shareId = generateShareId()
    let shareUrl = null

    try {
      const { error: dbError } = await supabase.from('playlists').insert({
        share_id: shareId,
        prompt,
        title: playlistName,
        songs: foundSongs,
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
      title: playlistName,
      prompt,
      songs: foundSongs,
      share_url: shareUrl,
      spotify_uris: foundSongs.map(s => s.spotify_uri),
    })

  } catch (error) {
    console.error('Error in generate-playlist:', error)
    return Response.json({
      error: 'Internal server error',
      details: error.message,
      success: false,
    }, { status: 500 })
  }
}
