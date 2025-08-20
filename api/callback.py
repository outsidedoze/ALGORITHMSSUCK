from flask import Flask, request, jsonify
import os
import requests
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

@app.route('/api/callback', methods=['POST'])
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

def handler(request):
    return app(request.environ, request.start_response)