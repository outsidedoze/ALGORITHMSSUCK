import { supabase, generateShareId } from '@/lib/supabase'
import { auth } from '@clerk/nextjs/server'

export async function POST(request) {
  try {
    // Get Clerk user ID for identity/billing
    const { userId: clerkUserId } = await auth()
    if (!clerkUserId) {
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 })
    }

    const data = await request.json();
    const { prompt, access_token } = data;

    if (!prompt || !access_token) {
      return Response.json({
        error: 'Missing required fields',
        success: false
      }, { status: 400 });
    }

    // Get user profile from Spotify (for taste data + email for admin check)
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });

    if (!userResponse.ok) {
      return Response.json({ error: 'Failed to get user profile', success: false }, { status: 401 });
    }

    const userProfile = await userResponse.json();
    const spotifyUserId = userProfile.id; // used only for Spotify API calls
    const userEmail = userProfile.email || '';

    // --- Admin check (by email) ---
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
    const isAdmin = adminEmails.includes(userEmail.toLowerCase());

    // --- Usage tracking + freemium gate (keyed on Clerk user ID) ---
    const freeLimit = parseInt(process.env.FREE_PLAYLIST_LIMIT || '3', 10);

    if (!isAdmin) {
      // Upsert user record keyed on Clerk user ID
      const { data: userRecord, error: upsertError } = await supabase
        .from('users')
        .upsert({ id: clerkUserId, email: userEmail }, { onConflict: 'id' })
        .select('playlist_count, free_credits, is_subscribed, credits')
        .single();

      if (!upsertError && userRecord) {
        const hasSubscription = userRecord.is_subscribed;
        const paidCredits = userRecord.credits || 0;
        const freeUsed = userRecord.playlist_count || 0;
        const freeRemaining = Math.max(0, freeLimit - freeUsed);

        if (!hasSubscription && paidCredits === 0 && freeRemaining === 0) {
          return Response.json({
            success: false,
            paywall: true,
            message: `You've used your ${freeLimit} free playlists. Subscribe for unlimited or buy a credit pack to keep going.`,
            playlists_used: freeUsed,
            free_limit: freeLimit,
          }, { status: 402 });
        }
      }
    }

    // Fetch listening data in parallel
    const [recentTracksResponse, topTracksResponse, topArtistsResponse] = await Promise.all([
      fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      }),
      fetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      }),
      fetch('https://api.spotify.com/v1/me/top/artists?limit=20&time_range=medium_term', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      })
    ]);

    let avoidSongIds = new Set();
    let avoidArtistNames = new Set();
    let tasteProfileArtists = [];

    if (recentTracksResponse.ok) {
      const recentData = await recentTracksResponse.json();
      recentData.items.forEach(item => {
        avoidSongIds.add(item.track.id);
        avoidArtistNames.add(item.track.artists[0].name);
      });
    }

    if (topTracksResponse.ok) {
      const topData = await topTracksResponse.json();
      topData.items.forEach(track => {
        avoidSongIds.add(track.id);
        avoidArtistNames.add(track.artists[0].name);
      });
    }

    if (topArtistsResponse.ok) {
      const topArtistsData = await topArtistsResponse.json();
      tasteProfileArtists = topArtistsData.items.map(a => a.name);
      tasteProfileArtists.forEach(name => avoidArtistNames.add(name));
    }

    // Build the prompt for Claude Haiku
    const systemPrompt = `You are a world-class music curator with encyclopedic knowledge of every genre, scene, era, and geography in recorded music history. Your reputation is built on two things: absolute precision and genuine discovery.

STEP 1 — READ THE REQUEST AND CHOOSE YOUR MODE:

If the request names a specific genre (house, jazz, techno, hip-hop, ambient, drum and bass, soul, reggae, metal, country, classical, etc.) → you are in GENRE MODE.
If the request describes a mood, feeling, moment, or vibe → you are in VIBE MODE.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GENRE MODE — Encyclopedic precision within the genre
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When a genre is named, you stay inside it — every single track. You demonstrate mastery by spanning:
- Multiple subgenres within it (e.g. house = deep house, acid house, Chicago house, UK garage, afro house, tech house, minimal, etc.)
- Multiple eras (the genre's origins through to recent years)
- Multiple geographies (the scene's birthplace + how it spread globally)
- Overlooked scenes, cult classics, regional variants the listener has never touched

The discovery here comes from DEPTH, not genre-hopping. A house fan who gets 20 precisely curated house tracks from scenes and eras they didn't know existed — that's the magic.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VIBE MODE — Cross-genre emotional coherence
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When the request is a mood or feeling, range freely across genres — but every song must serve the emotional core. Think in textures, tempos, production eras, atmosphere. The playlist should feel like it was sequenced by someone who understood exactly what the listener needed, even if they couldn't name it.

STEP 2 — ANALYZE THE LISTENER'S TASTE PROFILE:
Look at their top artists. Ask: What production era do they gravitate toward? What energy level? What emotional register? What does this tell you about what they'll respond to — even in music they've never heard? Use this to calibrate your picks, not to repeat what they already know.

STEP 3 — BUILD WITH THESE STANDARDS:
- Every track should feel like a revelation — the "how did I not know this existed" feeling
- Span eras, geographies, and subgenres within the mode you've chosen
- Sequence it with intention — the playlist has arc, shape, flow
- Pull from: overlooked classics, cult scenes, international artists, critically acclaimed records that flew under the radar, deep cuts from legendary careers
- The reason for each song should be specific and musical — name what makes it special (the production, the era, the scene, the sonic quality), and connect it to what this listener specifically values

ANTI-HALLUCINATION PROTOCOL — this is critical:
Only include artists and songs you are completely certain exist and are on Spotify. If you have any doubt at all about whether a specific song by a specific artist exists on Spotify — do not include it. Choose a different track you are 100% certain of. A playlist with 20 confidently real tracks is far better than one with invented ones. Well-known artists are fine. Cult and obscure artists are fine if you are certain. Uncertainty = skip it.

HARD RULES:
- Exactly 20 songs
- Never include any artist from their known rotation
- Never repeat artists
- If a time period is mentioned, be strict about it
- Playlist title: sharp, specific, evocative — earns the click

Return valid JSON only, no markdown, no other text:
{"title": "Playlist Title Here", "songs": [{"name": "Song Name", "artist": "Artist Name", "reason": "Specific, musical reason — what scene/era/sonic quality makes this right for this listener"}]}`;

    const userPrompt = `LISTENER'S TASTE PROFILE (their most-played artists):
${tasteProfileArtists.length > 0 ? tasteProfileArtists.join(', ') : 'Not available'}

ARTISTS TO AVOID — already in their world, do not include:
${Array.from(avoidArtistNames).slice(0, 40).join(', ')}

THEIR REQUEST: "${prompt}"

First, identify: is this a genre request or a vibe request? Then build 20 tracks accordingly. Be precise. Be musical. Only include songs you are 100% certain exist on Spotify. Return JSON only.`;

    // Call Claude Haiku via Anthropic API
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
    });

    let claudeSongs = [];
    let aiTitle = null;

    if (anthropicResponse.ok) {
      const anthropicData = await anthropicResponse.json();
      const rawText = anthropicData.content[0].text;
      console.log('Claude raw response:', rawText);

      try {
        // Strip markdown code blocks if Claude adds them
        const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(jsonText);
        claudeSongs = parsed.songs || [];
        aiTitle = parsed.title || null;
        console.log('Claude parsed songs:', claudeSongs.length);
        console.log('AI title:', aiTitle);
      } catch (e) {
        console.log('Failed to parse Claude response:', e.message);
        console.log('Raw response was:', rawText);
      }
    } else {
      const errorText = await anthropicResponse.text();
      console.log('Anthropic API error:', anthropicResponse.status, errorText);
    }

    // Search for each song on Spotify
    const searchPromises = claudeSongs.slice(0, 20).map(async (song) => {
      try {
        // Helper to extract a result from a search response
        const extractTrack = (items) => {
          if (!items || items.length === 0) return null;
          const track = items.find(t => !avoidSongIds.has(t.id)) || items[0];
          if (avoidSongIds.has(track.id)) return null;
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
            reason: song.reason
          };
        };

        // First try: strict field filter search
        const strictQuery = encodeURIComponent(`track:${song.name} artist:${song.artist}`);
        const strictResponse = await fetch(
          `https://api.spotify.com/v1/search?q=${strictQuery}&type=track&limit=3`,
          { headers: { 'Authorization': `Bearer ${access_token}` } }
        );
        if (strictResponse.ok) {
          const strictData = await strictResponse.json();
          const result = extractTrack(strictData.tracks.items);
          if (result) return result;
        }

        // Fallback: plain text search (more forgiving of special chars / slight name differences)
        const looseQuery = encodeURIComponent(`${song.name} ${song.artist}`);
        const looseResponse = await fetch(
          `https://api.spotify.com/v1/search?q=${looseQuery}&type=track&limit=5`,
          { headers: { 'Authorization': `Bearer ${access_token}` } }
        );
        if (looseResponse.ok) {
          const looseData = await looseResponse.json();
          return extractTrack(looseData.tracks.items);
        }
      } catch (error) {
        console.error('Error searching for song:', song, error);
      }
      return null;
    });

    const foundSongs = (await Promise.all(searchPromises)).filter(Boolean);

    if (foundSongs.length === 0) {
      return Response.json({
        success: false,
        message: 'No songs found for your prompt',
        prompt,
        songs: []
      });
    }

    if (foundSongs.length < 5) {
      return Response.json({
        success: false,
        message: `Only found ${foundSongs.length} songs — need at least 5 for a good playlist`,
        prompt,
        songs: foundSongs
      });
    }

    console.log('Found', foundSongs.length, 'songs for playlist');

    // Create the playlist
    const playlistName = aiTitle || `Discovery: ${prompt.slice(0, 40)}`;

    const createPlaylistResponse = await fetch(`https://api.spotify.com/v1/me/playlists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: playlistName,
        description: '🎵 Curated by AI — all new music, zero algorithm',
        public: false
      })
    });

    if (!createPlaylistResponse.ok) {
      const errorText = await createPlaylistResponse.text();
      console.log('Playlist creation failed:', createPlaylistResponse.status, errorText);
      return Response.json({
        success: false,
        message: 'Found songs but failed to create playlist',
        error: errorText,
        songs: foundSongs
      });
    }

    const playlist = await createPlaylistResponse.json();

    // Add tracks to the playlist
    const trackUris = foundSongs.map(song => `spotify:track:${song.spotify_id}`);
    await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: trackUris })
    });

    // Save to Supabase for shareable link
    let shareUrl = null;
    try {
      const shareId = generateShareId();
      const { error: dbError } = await supabase.from('playlists').insert({
        share_id: shareId,
        prompt,
        title: playlistName,
        songs: foundSongs,
        spotify_url: playlist.external_urls.spotify,
        user_id: clerkUserId,
      });

      if (!dbError) {
        shareUrl = `https://www.algorithmssuck.com/playlist/${shareId}`;
        console.log('Saved playlist with share URL:', shareUrl);

        // Increment playlist count for non-admins
        if (!isAdmin) {
          await supabase.rpc('increment_playlist_count', { user_id_input: clerkUserId });
        }
      } else {
        console.log('Failed to save playlist to DB:', dbError.message);
      }
    } catch (dbErr) {
      console.log('DB save error (non-fatal):', dbErr.message);
    }

    return Response.json({
      success: true,
      message: `Successfully created "${playlistName}" with ${foundSongs.length} songs!`,
      prompt,
      songs: foundSongs,
      playlist_id: playlist.id,
      playlist_url: playlist.external_urls.spotify,
      share_url: shareUrl,
    });

  } catch (error) {
    console.error('Error in generate-playlist:', error);
    return Response.json({
      error: 'Internal server error',
      details: error.message,
      success: false
    }, { status: 500 });
  }
}
