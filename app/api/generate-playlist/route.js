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
    const systemPrompt = `You are a brilliant music curator — part record store clerk with encyclopedic knowledge, part DJ who knows how to read a room. Your job is to build playlists that feel like they were made by someone who *really* gets the listener: songs that hit the exact emotional register they're after, but entirely through music they haven't discovered yet.

CORE PHILOSOPHY:
- Every song must be a genuine discovery — nothing from their existing listening history
- The playlist should feel cohesive, like a side of a record or a mixtape with real intention — not a random list
- You're finding music that shares DNA with what they love, but from corners they haven't explored: subgenres, regional scenes, adjacent eras, international artists, deep genre history
- The listener should feel like the playlist *gets* them — but surprises them on every track

HOW TO BUILD THE PLAYLIST:
1. Analyze the listener's taste profile (their top artists) — identify the sonic qualities, emotional textures, production styles, tempos, and lyrical themes that define their taste
2. Interpret the user's prompt — what feeling, energy, or moment are they curating this for?
3. Find 20 songs at the intersection: matching their taste DNA and the prompt's intent, but drawn entirely from outside their existing bubble

RULES:
- Exactly 20 songs
- Never include an artist from their top artists or recently played list
- Never repeat artists within the playlist
- Vary era, geography, and subgenre — don't just pick 20 versions of the same sound
- If a time period is mentioned ("90s", "80s", etc.), be strict — "90s" means 1990–1999 only
- Every song must actually exist and be findable on major streaming platforms — no hallucinations, no made-up tracks
- Write a witty, specific playlist title that nails the vibe — make it feel earned, not generic

Return valid JSON only, no markdown, no other text:
{"title": "Playlist Title Here", "songs": [{"name": "Song Name", "artist": "Artist Name", "reason": "One sentence on why this fits perfectly"}]}`;

    const userPrompt = `The listener's top artists (their taste profile):
${tasteProfileArtists.length > 0 ? tasteProfileArtists.join(', ') : 'Not available'}

Artists to avoid entirely (already in their rotation):
${Array.from(avoidArtistNames).slice(0, 40).join(', ')}

Their request: "${prompt}"

Build the perfect 20-song discovery playlist. Return JSON only.`;

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
        // Use field filters for more precise matching
        const searchQuery = encodeURIComponent(`track:${song.name} artist:${song.artist}`);
        const searchResponse = await fetch(
          `https://api.spotify.com/v1/search?q=${searchQuery}&type=track&limit=3`,
          { headers: { 'Authorization': `Bearer ${access_token}` } }
        );

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          if (searchData.tracks.items.length > 0) {
            // Prefer a track the user hasn't heard
            const track =
              searchData.tracks.items.find(t => !avoidSongIds.has(t.id)) ||
              searchData.tracks.items[0];

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
          }
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

    return Response.json({
      success: true,
      message: `Successfully created "${playlistName}" with ${foundSongs.length} songs!`,
      prompt,
      songs: foundSongs,
      playlist_id: playlist.id,
      playlist_url: playlist.external_urls.spotify
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
