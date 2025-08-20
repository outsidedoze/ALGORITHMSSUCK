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

    // Get user profile for playlist creation
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });

    if (!userResponse.ok) {
      return Response.json({
        error: 'Failed to get user profile',
        success: false
      }, { status: 401 });
    }

    const userProfile = await userResponse.json();

    // Get ChatGPT recommendations
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are an expert music curator with deep knowledge across all genres. Your goal is to create the perfect playlist that matches the user\'s request. IMPORTANT RULES: 1) If user specifies a time period (like "1960s", "80s", "from 1975"), only include songs from that era. 2) If user says "sounds like [artist]" or "merge [artist]", include 1-2 songs from that artist maximum, then focus on OTHER artists with similar styles - people want discovery, not just the same artist. 3) Consider tempo, mood, energy level, lyrical themes, and flow between songs. 4) Mix well-known hits with hidden gems and deep cuts. 5) Include diverse artists while maintaining playlist coherence. 6) Prioritize songs actually available on Spotify. Return exactly 20 songs in this JSON format: {"songs": [{"name": "Song Title", "artist": "Artist Name", "reason": "Why this song fits perfectly - mention specific musical elements, mood, or thematic connections"}]}. Only return valid JSON.'
          },
          {
            role: 'user',
            content: `Create a playlist for: ${prompt}`
          }
        ],
        max_tokens: 2000,
        temperature: 0.7
      })
    });

    let chatgptSongs = [];
    let usedChatGPT = false;

    if (openaiResponse.ok) {
      const chatgptData = await openaiResponse.json();
      console.log('ChatGPT raw response:', chatgptData.choices[0].message.content);
      try {
        const parsed = JSON.parse(chatgptData.choices[0].message.content);
        chatgptSongs = parsed.songs || [];
        usedChatGPT = true;
        console.log('ChatGPT parsed songs:', chatgptSongs.length);
      } catch (e) {
        console.log('Failed to parse ChatGPT response:', e.message);
        console.log('ChatGPT response content:', chatgptData.choices[0].message.content);
      }
    } else {
      console.log('ChatGPT API failed:', openaiResponse.status, await openaiResponse.text());
    }

    // Search for songs on Spotify
    const foundSongs = [];
    const searchPromises = chatgptSongs.slice(0, 20).map(async (song) => {
      try {
        const searchQuery = encodeURIComponent(`${song.name} ${song.artist}`);
        const searchResponse = await fetch(`https://api.spotify.com/v1/search?q=${searchQuery}&type=track&limit=1`, {
          headers: {
            'Authorization': `Bearer ${access_token}`
          }
        });

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          if (searchData.tracks.items.length > 0) {
            const track = searchData.tracks.items[0];
            return {
              name: track.name,
              artist: track.artists[0].name,
              spotify_id: track.id,
              preview_url: track.preview_url,
              external_url: track.external_urls.spotify,
              popularity: track.popularity,
              year: track.album.release_date ? new Date(track.album.release_date).getFullYear() : null,
              chatgpt_reason: song.reason
            };
          }
        }
      } catch (error) {
        console.error('Error searching for song:', song, error);
      }
      return null;
    });

    const searchResults = await Promise.all(searchPromises);
    foundSongs.push(...searchResults.filter(song => song !== null));

    // If no ChatGPT songs found, do a fallback search
    if (foundSongs.length === 0) {
      const fallbackResponse = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(prompt)}&type=track&limit=20`, {
        headers: {
          'Authorization': `Bearer ${access_token}`
        }
      });

      if (fallbackResponse.ok) {
        const fallbackData = await fallbackResponse.json();
        foundSongs.push(...fallbackData.tracks.items.map(track => ({
          name: track.name,
          artist: track.artists[0].name,
          spotify_id: track.id,
          preview_url: track.preview_url,
          external_url: track.external_urls.spotify,
          popularity: track.popularity,
          year: track.album.release_date ? new Date(track.album.release_date).getFullYear() : null
        })));
      }
    }

    if (foundSongs.length === 0) {
      return Response.json({
        success: false,
        message: 'No songs found for your prompt',
        prompt: prompt,
        songs: [],
        used_chatgpt: usedChatGPT
      });
    }

    // Create playlist
    const playlistName = `AI Playlist: ${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}`;
    const createPlaylistResponse = await fetch(`https://api.spotify.com/v1/users/${userProfile.id}/playlists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: playlistName,
        description: `Generated by Playlist Genius AI based on: "${prompt}"`,
        public: false
      })
    });

    if (!createPlaylistResponse.ok) {
      return Response.json({
        success: false,
        message: 'Found songs but failed to create playlist',
        prompt: prompt,
        songs: foundSongs,
        used_chatgpt: usedChatGPT
      });
    }

    const playlist = await createPlaylistResponse.json();

    // Add tracks to playlist
    const trackUris = foundSongs.map(song => `spotify:track:${song.spotify_id}`);
    await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uris: trackUris
      })
    });

    return Response.json({
      success: true,
      message: `Successfully created playlist with ${foundSongs.length} songs!`,
      prompt: prompt,
      songs: foundSongs,
      playlist_id: playlist.id,
      playlist_url: playlist.external_urls.spotify,
      used_chatgpt: usedChatGPT
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