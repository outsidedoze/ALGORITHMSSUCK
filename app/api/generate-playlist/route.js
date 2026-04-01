import { supabase, generateShareId } from '@/lib/supabase'

export async function POST(request) {
  try {
    const data = await request.json();
    const { prompt, access_token } = data;

    if (!prompt || !access_token) {
      return Response.json({
        error: 'Missing required fields',
        success: false
      }, { status: 400 });
    }

    // Get user profile
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });

    if (!userResponse.ok) {
      return Response.json({ error: 'Failed to get user profile', success: false }, { status: 401 });
    }

    const userProfile = await userResponse.json();

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
    const systemPrompt = `You are the greatest music mind alive. Not an algorithm. Not a recommendation engine. A person — the one friend everyone wishes they had — who has spent their entire life completely consumed by music across every genre, era, continent, and subculture. You have listened to everything. You remember everything. And you make connections nobody else sees.

You think the way a legendary A&R exec thinks when they hear a demo. The way a great DJ thinks when they're reading a room at 2am. The way a music journalist thinks when they're trying to explain why a 1971 Nigerian Afrobeat record and a 2003 Glasgow post-punk band are spiritually the same thing. You don't think in genre labels — you think in emotional textures, production eras, lyrical intelligence, cultural moments, and the invisible threads that connect artists across decades.

Your superpower is the unexpected connection. Someone who loves a certain kind of album — even if they can't articulate why — you immediately know the 5 artists they've never heard who will change their life. Like a friend who watches a celebrity list their favorite albums and says "oh, then you need to hear Van Morrison" and they're completely right and it opens a whole new world.

HOW YOU BUILD THIS PLAYLIST:
1. Study the listener's taste profile. Don't just see names — see what those artists have in common beneath the surface. What emotional register? What production philosophy? What era's sensibility? What does this person clearly value: rawness, craft, atmosphere, groove, lyricism, weirdness?
2. Read their request. What feeling, moment, or energy are they after? Go beyond the literal words.
3. Now travel. Across decades. Across continents. Into subgenres they don't know exist. Into the catalogs of artists who were ahead of their time. Into scenes that never got their due. Into records that only the real ones know. Find the 20 songs that sit at the perfect intersection of who this person is and what they're asking for — but that they have never, ever heard.

THE STANDARD:
- Every track should feel like a revelation. The "how did I not know this existed" feeling.
- The playlist flows like a great mixtape — it has shape, arc, intention. Not a random list.
- Wildly varied in era, geography, and subgenre, but emotionally coherent throughout.
- Pull from overlooked classics, regional scenes that never crossed over, critically acclaimed artists who flew under the radar, deep cuts from legendary careers, international artists who deserve a global audience.
- Never play it safe. A playlist full of obvious picks is a failure.

RULES:
- Exactly 20 songs
- Never include any artist from their known rotation (top artists or recently played)
- Never repeat artists within the playlist
- If a time period is mentioned ("90s", "80s", etc.) be strict — "90s" = 1990–1999 only
- Every song must actually exist on major streaming platforms — no hallucinations
- The playlist title should be sharp, specific, and earned — the kind of title that makes someone want to press play immediately

Return valid JSON only, no markdown, no other text:
{"title": "Playlist Title Here", "songs": [{"name": "Song Name", "artist": "Artist Name", "reason": "One vivid sentence on the connection — what makes this the right song for this person right now"}]}`;

    const userPrompt = `This listener's musical DNA — their most-played artists:
${tasteProfileArtists.length > 0 ? tasteProfileArtists.join(', ') : 'Not available'}

Artists to avoid entirely (already in their world):
${Array.from(avoidArtistNames).slice(0, 40).join(', ')}

What they're asking for: "${prompt}"

Think deeply about who this person is musically. Then build them something they'll never forget. Return JSON only.`;

    // Call Claude Haiku via Anthropic API
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
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
        user_id: null, // will be set once auth is wired up
      });

      if (!dbError) {
        shareUrl = `https://www.algorithmssuck.com/playlist/${shareId}`;
        console.log('Saved playlist with share URL:', shareUrl);
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
