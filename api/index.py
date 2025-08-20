from http.server import BaseHTTPRequestHandler
import json
import os
import requests
from urllib.parse import urlparse, parse_qs
from dotenv import load_dotenv

load_dotenv()

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        # Parse the URL path
        path = urlparse(self.path).path
        
        # Route to appropriate function based on path
        if path == '/api/callback':
            self.handle_callback()
        elif path == '/api/generate-playlist':
            self.handle_generate_playlist()
        elif path == '/api/me':
            self.handle_me()
        else:
            self.send_error(404, 'Not Found')
    
    def handle_callback(self):
        try:
            # Read request body
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            print(f"Received data: {data}")
            
            if not data:
                self.send_json_response({'error': 'No JSON data received'}, 400)
                return
            
            code = data.get('code')
            redirect_uri = data.get('redirect_uri')
            code_verifier = data.get('code_verifier')

            print(f"Code: {code}")
            print(f"Redirect URI: {redirect_uri}")
            print(f"Code verifier: {code_verifier}")

            if not code or not redirect_uri or not code_verifier:
                print("Missing required fields")
                self.send_json_response({'error': 'Missing required fields', 'received': data}, 400)
                return

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
                self.send_json_response(error_data, 500)
                return

            spotify_response = response.json()
            print(f"Successfully got tokens: {list(spotify_response.keys())}")
            self.send_json_response(spotify_response, 200)
            
        except Exception as e:
            print(f"Error in callback: {str(e)}")
            import traceback
            traceback.print_exc()
            self.send_json_response({'error': 'Internal server error', 'details': str(e)}, 500)
    
    def handle_generate_playlist(self):
        # Placeholder for now - return success
        self.send_json_response({'message': 'Generate playlist endpoint working'}, 200)
    
    def handle_me(self):
        try:
            # Read request body
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            access_token = data.get("access_token")

            headers = {
                "Authorization": f"Bearer {access_token}"
            }

            r = requests.get("https://api.spotify.com/v1/me", headers=headers)

            if r.status_code != 200:
                self.send_json_response({
                    "error": "Failed to fetch user profile",
                    "details": r.json()
                }, 400)
                return

            self.send_json_response(r.json(), 200)
            
        except Exception as e:
            print(f"Error in me: {str(e)}")
            self.send_json_response({'error': 'Internal server error', 'details': str(e)}, 500)
    
    def send_json_response(self, data, status_code):
        self.send_response(status_code)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()