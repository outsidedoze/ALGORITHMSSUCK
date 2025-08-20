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

    // Get user's listening history to avoid overplayed songs
    const recentTracksResponse = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });

    const topTracksResponse = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });

    let avoidSongs = new Set();
    let avoidArtists = new Set();

    // Add recently played tracks to avoid list
    if (recentTracksResponse.ok) {
      const recentData = await recentTracksResponse.json();
      recentData.items.forEach(item => {
        avoidSongs.add(item.track.id);
        avoidArtists.add(item.track.artists[0].name.toLowerCase());
      });
      console.log('Avoiding', recentData.items.length, 'recently played tracks');
    }

    // Add top tracks to avoid list (songs they already love)
    if (topTracksResponse.ok) {
      const topData = await topTracksResponse.json();
      topData.items.forEach(track => {
        avoidSongs.add(track.id);
        avoidArtists.add(track.artists[0].name.toLowerCase());
      });
      console.log('Avoiding', topData.items.length, 'top tracks');
    }

    console.log('Total songs to avoid:', avoidSongs.size);
    console.log('Total artists to avoid:', avoidArtists.size);

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
            content: 'You are an expert music curator with deep knowledge across all genres. Your goal is to create the perfect playlist that matches the user\'s request. CRITICAL RULES: 1) If user specifies a time period (like "1960s", "80s", "from 1975"), only include songs from that era. 2) If user mentions specific artists (like "sounds like Tame Impala" or "merge Radiohead"), include MAXIMUM 1-2 songs from each mentioned artist, then focus on OTHER DIFFERENT artists with similar styles - people want discovery of NEW artists, not just the same ones repeated. 3) Never include more than 2 songs from the same artist in any playlist. 4) Consider tempo, mood, energy level, lyrical themes, and flow between songs. 5) Mix well-known hits with hidden gems and deep cuts. 6) Include diverse artists while maintaining playlist coherence. 7) Prioritize songs actually available on Spotify. Return exactly 20 songs in this JSON format: {"songs": [{"name": "Song Title", "artist": "Artist Name", "reason": "Why this song fits perfectly - mention specific musical elements, mood, or thematic connections"}]}. Only return valid JSON.'
          },
          {
            role: 'user',
            content: `Create a playlist for: ${prompt}

IMPORTANT: Focus on DISCOVERY. Avoid these artists the user already knows well: ${Array.from(avoidArtists).slice(0, 20).join(', ')}. Instead, find similar but DIFFERENT artists they haven't discovered yet.`
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
            
            // Skip if user already knows this song well
            if (avoidSongs.has(track.id)) {
              console.log('Skipping known song:', track.name, 'by', track.artists[0].name);
              return null;
            }
            
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

    if (foundSongs.length < 5) {
      return Response.json({
        success: false,
        message: `Only found ${foundSongs.length} songs - need at least 5 for a good playlist`,
        prompt: prompt,
        songs: foundSongs,
        used_chatgpt: usedChatGPT
      });
    }

    console.log('Found', foundSongs.length, 'songs for playlist');

    // Test if we have playlist creation permissions
    const testResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });
    
    if (!testResponse.ok) {
      return Response.json({
        success: false,
        message: 'Token validation failed',
        error: await testResponse.text()
      }, { status: 401 });
    }

    // Create playlist
    const sanitizedPrompt = prompt.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const shortPrompt = sanitizedPrompt.slice(0, 40);
    const playlistName = `AI Discovery ${shortPrompt}`;
    console.log('Creating playlist for user:', userProfile.id);
    console.log('Playlist name:', playlistName);
    console.log('Original prompt:', prompt);
    console.log('Sanitized prompt:', sanitizedPrompt);
    
    // Try the simplest possible playlist creation first
    const playlistBody = {
      name: "AI Discovery Test",
      public: false
    };
    
    console.log('Playlist request body:', JSON.stringify(playlistBody, null, 2));
    
    const createPlaylistResponse = await fetch(`https://api.spotify.com/v1/me/playlists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(playlistBody)
    });

    if (!createPlaylistResponse.ok) {
      const errorText = await createPlaylistResponse.text();
      console.log('Playlist creation failed:', createPlaylistResponse.status, errorText);
      return Response.json({
        success: false,
        message: 'Found songs but failed to create playlist',
        error: errorText,
        status: createPlaylistResponse.status,
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