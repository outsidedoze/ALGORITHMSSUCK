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
            content: 'You are a music curator with IMPECCABLE TASTE. Create playlists with EXACTLY 20 songs: 70% hidden gems, 30% familiar tracks.\n\nCRITICAL RULES:\n1) RETURN EXACTLY 20 SONGS - never less, never more\n2) RESPECT TIME PERIODS STRICTLY: "90s" = 1990-1999 ONLY, "80s" = 1980-1989 ONLY, etc. Check release dates!\n3) QUALITY OVER OBSCURITY: Up-and-coming artists with critical acclaim, rave reviews, buzz in music circles\n4) Target genuinely talented artists under 500k monthly listeners\n5) Include Pitchfork/Fader/NPR Music/Rolling Stone featured artists\n6) Never repeat artists - each song must be from different artist\n7) Balance discovery gems with familiar anchor tracks\n\nCREATE a witty, memorable playlist title. Gen Z cool, funny, shareable. Swearing OK.\n\nReturn EXACTLY this JSON format:\n{"title": "Creative Title Here", "songs": [20 song objects with name/artist/reason]}\n\nMUST return valid JSON with exactly 20 songs.'
          },
          {
            role: 'user',
            content: `FIRST: Check if this request mentions a time period like "90s", "80s", "70s", "60s", "from 1995", etc.

User request: "${prompt}"

TIME PERIOD CHECK:
- If ANY time period is mentioned, ONLY include songs released in those exact years
- "90s" = 1990-1999 releases ONLY
- "80s" = 1980-1989 releases ONLY  
- "70s" = 1970-1979 releases ONLY
- Be STRICT about release dates - check them!

DISCOVERY FOCUS: Avoid these artists the user knows: ${Array.from(avoidArtists).slice(0, 20).join(', ')}

Create exactly 20 songs following all rules above.`
          }
        ],
        max_tokens: 2000,
        temperature: 0.7
      })
    });

    let chatgptSongs = [];
    let aiTitle = null;
    let usedChatGPT = false;

    if (openaiResponse.ok) {
      const chatgptData = await openaiResponse.json();
      console.log('ChatGPT raw response:', chatgptData.choices[0].message.content);
      try {
        const parsed = JSON.parse(chatgptData.choices[0].message.content);
        chatgptSongs = parsed.songs || [];
        aiTitle = parsed.title || null;
        usedChatGPT = true;
        console.log('ChatGPT parsed songs:', chatgptSongs.length);
        console.log('AI generated title:', aiTitle);
        console.log('Parsed object keys:', Object.keys(parsed));
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
            
            // Skip mega-hit songs (above 85 popularity) but allow some popular tracks
            if (track.popularity > 85) {
              console.log('Skipping mega-hit song:', track.name, 'by', track.artists[0].name, '(popularity:', track.popularity + ')');
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
    const playlistName = aiTitle || `AI Discovery: ${prompt.slice(0, 40)}...`;
    console.log('Creating playlist for user:', userProfile.id);
    console.log('Playlist name:', playlistName);
    console.log('AI-generated title:', aiTitle);
    
    const playlistBody = {
      name: playlistName,
      description: "🎵 AI-curated discovery playlist with hidden gems and familiar favorites",
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