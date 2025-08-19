from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import requests
import re
from datetime import datetime
from openai import OpenAI

# --- Load environment variables from .env ---
from dotenv import load_dotenv
load_dotenv()

# Initialize OpenAI client (reads OPENAI_API_KEY from environment or .env)
client = OpenAI()

def parse_era_range_from_prompt(prompt: str):
    """Return (start_year, end_year) if an era (e.g., '90s', 'late 80s', 'from 1980', '2000s') is detected, else (None, None)."""
    text = prompt.lower()

    # Specific year like 'from 1980' or 'in 1980' or standalone '1980'
    m_year = re.search(r'(?:from|in|around|circa)?\s*(\b(19\d{2}|20\d{2})\b)', text)
    if m_year:
        y = int(m_year.group(1))
        if 1900 <= y <= datetime.now().year:
            return (y, y)

    # Decade forms: '90s', '1990s', 'early/mid/late 90s'
    m_decade_simple = re.search(r'\b(\d{2})s\b', text)  # e.g., 90s
    m_decade_full = re.search(r'\b(19\d{2}|20\d{2})s\b', text)  # e.g., 1990s

    descriptor = None
    m_desc = re.search(r'\b(early|mid|late)\s+(19\d0s|20\d0s|\d0s|19\d{2}s|20\d{2}s|\d{2}s)\b', text)
    if m_desc:
        descriptor = m_desc.group(1)

    def decade_bounds(century_decade: int):
        start = century_decade
        end = century_decade + 9
        if descriptor == 'early':
            return (start, start + 3)
        if descriptor == 'mid':
            return (start + 4, start + 6)
        if descriptor == 'late':
            return (start + 7, end)
        return (start, end)

    if m_decade_full:
        decade_start = int(m_decade_full.group(1)[:3] + '0')
        return decade_bounds(decade_start)

    if m_decade_simple:
        two = int(m_decade_simple.group(1))  # 90 -> 1990s heuristic; 10 -> 2010s if prompt mentions 2010s elsewhere we already matched above
        # Heuristic: assume 1900s for 20-90, 2000s for 00-19
        if two >= 20:
            decade_start = 1900 + two
        else:
            decade_start = 2000 + two
        return decade_bounds(decade_start)

    # '2000s', '2010s', etc.
    m_two_thousands = re.search(r'\b(2000s|2010s|2020s)\b', text)
    if m_two_thousands:
        decade_start = int(m_two_thousands.group(1)[:4])
        return decade_bounds(decade_start)

    return (None, None)


def get_chatgpt_song_suggestions(prompt, user_listened_tracks_count, era_start=None, era_end=None):
    """Use ChatGPT to suggest specific songs based on the user's prompt"""
    try:
        era_clause = ""
        if era_start and era_end:
            era_clause = f"ABSOLUTELY CRITICAL: ONLY choose songs released between {era_start} and {era_end} (inclusive). Do NOT suggest songs from {era_start-100} to {era_start-10} or any other decades. Electronic dance music did not exist before 1970."

        # Parse multiple genres from the prompt
        prompt_lower = prompt.lower()
        detected_genres = []
        genre_keywords = {
            'disco': ['disco'],
            'funk': ['funk', 'funky'],
            'r&b': ['r&b', 'rnb', 'rhythm and blues', 'soul'],
            'electronic': ['electronic', 'synth', 'techno', 'edm'],
            'dance': ['dance', 'club'],
            'punk': ['punk'],
            'goth': ['goth', 'gothic'],
            'rock': ['rock'],
            'pop': ['pop'],
            'jazz': ['jazz'],
            'blues': ['blues'],
            'reggae': ['reggae'],
            'hip hop': ['hip hop', 'rap', 'hip-hop']
        }
        
        for genre, keywords in genre_keywords.items():
            if any(keyword in prompt_lower for keyword in keywords):
                detected_genres.append(genre)
        
        # If multiple genres detected, ask for balanced representation
        genre_instruction = ""
        if len(detected_genres) > 1:
            genre_instruction = f"IMPORTANT: The user mentioned {len(detected_genres)} genres: {', '.join(detected_genres)}. Make sure to include roughly equal amounts from each genre (about {20//len(detected_genres)} songs per genre)."
        
        chatgpt_prompt = f"""
You're that one friend who's obsessed with music — the one who always has the perfect song for any moment and knows the most insane deep cuts. You're chatting with someone about music, and they just described what they want to hear: "{prompt}"

Here's the thing — they've already got {user_listened_tracks_count} tracks in their recent listening history, so skip the obvious stuff everyone knows. You want to blow their mind with tracks that capture the EXACT vibe they're after, but ones they've probably never heard.

{era_clause if era_clause else ""}

{f"CRITICAL: ALL songs must be from {era_start}-{era_end}. Do NOT suggest songs from outside this time period. Check the year twice." if era_start and era_end else ""}

{genre_instruction}

Think like you're digging through your vinyl collection, Spotify playlists, and that USB drive of rare tracks you've been hoarding for years. Pick songs that:
- Actually SOUND like what they described (not just similar genre)
- Are criminally underrated or overlooked
- Have that "wait, who is this?" factor
- Would make them text you immediately asking for the artist name

Don't just think mainstream vs underground — think about B-sides from famous bands, international hits that never crossed over, album tracks that should've been singles, covers that are better than originals, and those perfect songs from one-hit-wonder bands.

Give me 20 tracks that would make you look like a musical genius. For each one, tell me why it's perfect for their vibe in the way you'd actually explain it to a friend.

JSON format:
[{{"title": "song name", "artist": "artist name", "year": release_year, "reason": "why this song is perfect (be conversational, not academic)"}}]
"""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You're a music obsessive with incredible taste and deep knowledge across all genres. You're the friend everyone goes to for music recs because you always know the perfect deep cut. You collect rare tracks, browse obscure forums, and have an encyclopedic memory for hidden gems. You speak casually but with passion about music. Always respond with valid JSON."},
                {"role": "user", "content": chatgpt_prompt}
            ],
            temperature=0.8,
            max_tokens=2000
        )

        # Parse the response to extract JSON
        content = response.choices[0].message.content.strip()
        
        # Try to extract JSON from the response
        import json
        import re
        
        # Remove markdown code blocks if present
        content = re.sub(r'```json\s*', '', content)
        content = re.sub(r'```\s*$', '', content)
        content = content.strip()
        
        try:
            # First try to parse the entire response as JSON
            suggestions = json.loads(content)
            print(f"Successfully parsed {len(suggestions)} ChatGPT suggestions")
            return suggestions
        except json.JSONDecodeError:
            # If that fails, look for JSON array in the response
            json_match = re.search(r'\[.*\]', content, re.DOTALL)
            if json_match:
                try:
                    suggestions = json.loads(json_match.group())
                    print(f"Successfully parsed {len(suggestions)} ChatGPT suggestions from extracted JSON")
                    return suggestions
                except json.JSONDecodeError as e:
                    print(f"JSON decode error: {e}")
                    print(f"Content: {json_match.group()[:500]}...")
                    return []
            else:
                print(f"Could not find JSON array in ChatGPT response: {content[:500]}...")
                return []
            
    except Exception as e:
        print(f"Error getting ChatGPT suggestions: {str(e)}")
        return []

app = Flask(__name__)
CORS(app)

@app.route("/")
def home():
    return "Backend is running!"

@app.route("/generate-playlist", methods=["POST"])
def generate_playlist():
    try:
        data = request.json
        prompt = data.get("prompt")
        access_token = data.get("access_token")

        if not prompt or not access_token:
            return jsonify({"error": "Missing prompt or access token"}), 400

        # Search for songs based on the prompt
        headers = {
            "Authorization": f"Bearer {access_token}"
        }

        # Check if access token is valid, if not skip user listening history
        user_listened_tracks = set()
        
        # Test token validity with a simple request
        try:
            test_response = requests.get("https://api.spotify.com/v1/me", headers=headers, timeout=3)
            if test_response.status_code == 401:
                print("Access token expired, skipping user listening history")
            elif test_response.status_code == 200:
                # Get recently played tracks
                try:
                    recent_url = "https://api.spotify.com/v1/me/player/recently-played"
                    recent_params = {"limit": 50}
                    recent_response = requests.get(recent_url, headers=headers, params=recent_params, timeout=3)
                    
                    if recent_response.status_code == 200:
                        recent_data = recent_response.json()
                        for item in recent_data.get("items", []):
                            user_listened_tracks.add(item["track"]["id"])
                        print(f"Found {len(user_listened_tracks)} recently played tracks")
                    else:
                        print(f"Failed to get recently played: {recent_response.text}")
                except Exception as e:
                    print(f"Error getting recently played: {str(e)}")
        except Exception as e:
            print(f"Error testing token: {str(e)}")

        # Get user's top tracks (short term)
        try:
            top_tracks_url = "https://api.spotify.com/v1/me/top/tracks"
            top_params = {"limit": 50, "time_range": "short_term"}
            top_response = requests.get(top_tracks_url, headers=headers, params=top_params)
            
            if top_response.status_code == 200:
                top_data = top_response.json()
                for track in top_data.get("items", []):
                    user_listened_tracks.add(track["id"])
                print(f"Found {len(user_listened_tracks)} total listened tracks")
            else:
                print(f"Failed to get top tracks: {top_response.text}")
        except Exception as e:
            print(f"Error getting top tracks: {str(e)}")

        # Parse era from prompt and pass guidance to ChatGPT
        era_start, era_end = parse_era_range_from_prompt(prompt)

        # Get ChatGPT suggestions for specific songs (with era guidance)
        chatgpt_suggestions = get_chatgpt_song_suggestions(prompt, len(user_listened_tracks), era_start, era_end)
        print(f"ChatGPT suggested {len(chatgpt_suggestions)} songs")
        
        # Debug: Print the actual suggestions
        for i, suggestion in enumerate(chatgpt_suggestions):
            print(f"Suggestion {i+1}: {suggestion}")

        # Only use tracks that match ChatGPT-suggested songs
        all_tracks = []

        def parse_year(s):
            try:
                return int(str(s)[:4])
            except Exception:
                return None

        for suggestion in chatgpt_suggestions:
            title = suggestion.get('title') or suggestion.get('name')
            artist = suggestion.get('artist')
            sugg_year = parse_year(suggestion.get('year'))

            # Try multiple search strategies - start strict, then fallback to looser searches
            search_queries = []
            
            # Strategy 1: Just title and artist without quotes (most reliable)
            if title and artist:
                search_queries.append(f"{title} {artist}")
            
            # Strategy 2: Artist only 
            if artist:
                search_queries.append(f"{artist}")
            
            # Strategy 3: Title only
            if title:
                search_queries.append(f"{title}")
            
            # Strategy 4: Remove common words that might interfere
            if title and artist:
                clean_title = title.replace("(Extended Remix)", "").replace("(Cover by", "").split("(")[0].strip()
                search_queries.append(f"{clean_title} {artist}")
            
            # Try each search strategy until we find a match
            chosen = None
            for search_query in search_queries:
                search_url = "https://api.spotify.com/v1/search"
                search_params = {
                    "q": search_query,
                    "type": "track",
                    "limit": 10,
                    "market": "US"
                }
                
                response = requests.get(search_url, headers=headers, params=search_params, timeout=3)
                if response.status_code == 401:
                    print(f"Token expired during search for: {title} by {artist}")
                    break  # Stop trying more search strategies if token is invalid
                elif response.status_code == 200:
                    search_results = response.json()
                    tracks = search_results.get("tracks", {}).get("items", [])
                    
                    # First priority: try to find tracks with exact year match
                    filtered = []
                    loose_filtered = []
                    
                    for t in tracks:
                        rel_date = t.get('album', {}).get('release_date')
                        rel_year = parse_year(rel_date) if rel_date else None
                        
                        # Era matching takes priority - if user specified era, enforce it strictly
                        if era_start and era_end and rel_year:
                            if era_start <= rel_year <= era_end:
                                filtered.append(t)
                            # Only allow ±2 years tolerance for era boundaries
                            elif abs(rel_year - era_start) <= 2 or abs(rel_year - era_end) <= 2:
                                loose_filtered.append(t)
                        # Individual year matching (±1 year)
                        elif sugg_year and rel_year and abs(rel_year - sugg_year) <= 1:
                            filtered.append(t)
                        # Loose matching for when no specific era but has suggested year
                        elif sugg_year and rel_year and abs(rel_year - sugg_year) <= 5:
                            loose_filtered.append(t)
                        # Track with no year info (only if no era specified)
                        elif not rel_year and not (era_start and era_end):
                            loose_filtered.append(t)

                    if filtered:
                        chosen = filtered[0]
                        break
                    elif loose_filtered:
                        chosen = loose_filtered[0]
                        print(f"Using loose match for: {title} by {artist}")
                        break
                    elif tracks:
                        # If all else fails, just take the first match for well-known artists
                        chosen = tracks[0]
                        print(f"Using any match for well-known track: {title} by {artist}")
                        break
                        
            if chosen:
                chosen['chatgpt_reason'] = suggestion.get('reason')
                chosen['chatgpt_year'] = sugg_year
                print(f"Found match for: {title} by {artist}")
                all_tracks.append(chosen)
            else:
                print(f"No Spotify match found for: {title} by {artist}")

        # If ChatGPT didn't return any usable matches, try a broader search as fallback
        if not all_tracks:
            print("No matches found for ChatGPT suggestions, trying broader search...")
            
            # Create a simpler prompt for broader results
            simple_prompt = prompt.lower()
            
            # Extract key genres/moods
            if "goth" in simple_prompt or "dark" in simple_prompt:
                fallback_terms = ["goth", "darkwave", "post punk"]
            elif "electronic" in simple_prompt and "dance" in simple_prompt:
                fallback_terms = ["electronic", "synth pop", "new wave"]
            elif "punk" in simple_prompt:
                fallback_terms = ["punk", "post punk", "new wave"]
            else:
                fallback_terms = ["alternative", "indie"]
            
            # Search for broader terms
            for term in fallback_terms:
                search_url = "https://api.spotify.com/v1/search"
                search_params = {
                    "q": f"genre:{term}",
                    "type": "track",
                    "limit": 15,
                    "market": "US"
                }
                
                try:
                    response = requests.get(search_url, headers=headers, params=search_params, timeout=3)
                    if response.status_code == 200:
                        search_results = response.json()
                        tracks = search_results.get("tracks", {}).get("items", [])
                        
                        # Filter to avoid duplicates
                        for track in tracks:
                            if track["id"] not in user_listened_tracks:
                                all_tracks.append(track)
                                if len(all_tracks) >= 10:  # Get at least 10 tracks
                                    break
                        
                        if len(all_tracks) >= 10:
                            break
                except:
                    continue
            
            if not all_tracks:
                return jsonify({
                    "success": False,
                    "error": "No tracks found for ChatGPT suggestions",
                    "message": "No tracks found for ChatGPT suggestions",
                    "prompt": prompt,
                    "songs": [],
                    "used_chatgpt": False
                }), 400

        # Remove duplicates and filter out songs user has already heard
        unique_tracks = {}
        for track in all_tracks:
            if track["id"] not in unique_tracks and track["id"] not in user_listened_tracks:
                unique_tracks[track["id"]] = track

        print(f"Found {len(unique_tracks)} unique tracks user hasn't heard")

        # Preserve ChatGPT order and take up to 15
        ordered_unique = []
        seen = set()
        for track in all_tracks:
            if track["id"] in unique_tracks and track["id"] not in seen:
                ordered_unique.append(unique_tracks[track["id"]])
                seen.add(track["id"])

        final_tracks = ordered_unique[:15]

        # Extract song information
        songs = []
        for track in final_tracks:
            artists = [artist["name"] for artist in track["artists"]]
            rel_date = track.get('album', {}).get('release_date')
            rel_year = None
            if rel_date:
                try:
                    rel_year = int(rel_date[:4])
                except Exception:
                    rel_year = None
            song_data = {
                "name": track["name"],
                "artist": ", ".join(artists),
                "spotify_id": track["id"],
                "preview_url": track.get("preview_url"),
                "external_url": track["external_urls"]["spotify"],
                "popularity": track.get("popularity", 0),
                "year": rel_year or track.get('chatgpt_year')
            }
            
            # Add ChatGPT reasoning if available
            if 'chatgpt_reason' in track:
                song_data['chatgpt_reason'] = track['chatgpt_reason']
            
            songs.append(song_data)

        # Create a new playlist
        user_id = None
        try:
            # Get user profile to get user ID
            me_response = requests.get("https://api.spotify.com/v1/me", headers=headers)
            print(f"User profile response status: {me_response.status_code}")
            if me_response.status_code == 200:
                user_id = me_response.json()["id"]
                print(f"User ID: {user_id}")
            else:
                print(f"Failed to get user profile: {me_response.text}")
        except Exception as e:
            print(f"Error getting user ID: {str(e)}")

        playlist_id = None
        if user_id:
            try:
                # Create playlist
                playlist_url = f"https://api.spotify.com/v1/users/{user_id}/playlists"
                # Truncate prompt to fit Spotify's playlist name limit (100 characters)
                playlist_name = f"Playlist Genius: {prompt[:80]}"
                if len(playlist_name) > 100:
                    playlist_name = playlist_name[:97] + "..."
                
                # Clean the description (remove newlines and extra spaces)
                clean_description = f"Generated by Playlist Genius based on: {prompt}".replace('\n', ' ').strip()
                
                playlist_data = {
                    "name": playlist_name,
                    "description": clean_description,
                    "public": True
                }
                
                print(f"Creating playlist with data: {playlist_data}")
                playlist_response = requests.post(playlist_url, headers=headers, json=playlist_data)
                print(f"Playlist creation response status: {playlist_response.status_code}")
                print(f"Playlist creation response: {playlist_response.text}")
                
                if playlist_response.status_code == 201:
                    playlist_id = playlist_response.json()["id"]
                    print(f"Playlist created with ID: {playlist_id}")
                    
                    # Add tracks to playlist
                    if songs:
                        track_uris = [f"spotify:track:{song['spotify_id']}" for song in songs]
                        add_tracks_url = f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks"
                        add_tracks_data = {"uris": track_uris}
                        
                        print(f"Adding tracks to playlist: {track_uris}")
                        add_response = requests.post(add_tracks_url, headers=headers, json=add_tracks_data)
                        print(f"Add tracks response status: {add_response.status_code}")
                        print(f"Add tracks response: {add_response.text}")
                        
                        if add_response.status_code not in [200, 201]:
                            print(f"Error adding tracks to playlist: {add_response.text}")
                        
                        # Follow the playlist to add it to user's library
                        follow_url = f"https://api.spotify.com/v1/playlists/{playlist_id}/followers"
                        follow_response = requests.put(follow_url, headers=headers)
                        print(f"Follow playlist response status: {follow_response.status_code}")
                        if follow_response.status_code not in [200, 201]:
                            print(f"Error following playlist: {follow_response.text}")
                else:
                    print(f"Failed to create playlist: {playlist_response.text}")
            except Exception as e:
                print(f"Error creating playlist: {str(e)}")
        else:
            print("No user ID available, skipping playlist creation")

        return jsonify({
            "success": True,
            "message": f"Found {len(songs)} songs from ChatGPT suggestions",
            "prompt": prompt,
            "songs": songs,
            "playlist_id": playlist_id,
            "playlist_url": f"https://open.spotify.com/playlist/{playlist_id}" if playlist_id else None,
            "used_chatgpt": True
        })
    except Exception as e:
        print(f"Error in generate_playlist: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500

# --- Spotify User Profile Route ---
import requests

@app.route("/me", methods=["POST"])
def get_user_profile():
    data = request.json
    access_token = data.get("access_token")

    headers = {
        "Authorization": f"Bearer {access_token}"
    }

    r = requests.get("https://api.spotify.com/v1/me", headers=headers)

    if r.status_code != 200:
        return jsonify({
            "error": "Failed to fetch user profile",
            "details": r.json()
        }), 400

    return jsonify(r.json())


# --- Spotify OAuth callback route for exchanging code for access token ---
@app.route('/callback', methods=['POST'])
def callback():
    try:
        data = request.get_json()
        print(f"Received data: {data}")
        
        if not data:
            print("No JSON data received")
            return jsonify({'error': 'No JSON data received'}), 400
        
        code = data.get('code')
        redirect_uri = data.get('redirect_uri')
        code_verifier = data.get('code_verifier')

        print(f"Code: {code}")
        print(f"Redirect URI: {redirect_uri}")
        print(f"Code verifier: {code_verifier}")

        if not code or not redirect_uri or not code_verifier:
            print("Missing required fields")
            return jsonify({'error': 'Missing required fields', 'received': data}), 400

        # Check if Spotify credentials are configured (fallback to frontend's public client_id for local dev)
        client_id = os.environ.get('SPOTIFY_CLIENT_ID') or '2ee0d98b21d048978bf73d78924daf91'
        print(f"Using client_id: {client_id}")

        token_url = 'https://accounts.spotify.com/api/token'
        payload = {
            'client_id': client_id,
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': redirect_uri,
            'code_verifier': code_verifier,
        }

        headers = {
            'Content-Type': 'application/x-www-form-urlencoded'
        }

        print(f"Sending to Spotify: {payload}")
        response = requests.post(token_url, data=payload, headers=headers)
        print(f"Spotify response status: {response.status_code}")
        print(f"Spotify response: {response.text}")

        if response.status_code != 200:
            error_data = {'error': 'Token exchange failed', 'status': response.status_code, 'response': response.text}
            try:
                error_data['details'] = response.json()
            except:
                error_data['details'] = response.text
            return jsonify(error_data), 500

        spotify_response = response.json()
        print(f"Successfully got tokens: {list(spotify_response.keys())}")
        return jsonify(spotify_response)
    except Exception as e:
        print(f"Error in callback: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Internal server error', 'details': str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True)