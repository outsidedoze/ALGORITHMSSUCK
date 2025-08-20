from flask import Flask, request, jsonify
import requests
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

@app.route("/api/me", methods=["POST"])
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

def handler(request):
    return app(request.environ, request.start_response)