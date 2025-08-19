'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function CallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const getAccessToken = async () => {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const verifier = localStorage.getItem('code_verifier')

      if (!code || !verifier) return console.error('Missing code or verifier')

      const body = new URLSearchParams({
        client_id: '2ee0d98b21d048978bf73d78924daf91',
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:3000/callback',
        code_verifier: verifier,
      })

      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })

      const data = await response.json()

      if (data.access_token) {
        localStorage.setItem('access_token', data.access_token)
        localStorage.removeItem('code_verifier')
        router.push('/')
      } else {
        console.error('Token exchange failed', data)
      }
    }

    getAccessToken()
  }, [router])

  return <div className="p-8 text-center">Logging you in with Spotify...</div>
}
@app.route('/callback', methods=['POST'])
def callback():
    data = request.get_json()
    code = data.get('code')
    redirect_uri = data.get('redirect_uri')
    code_verifier = data.get('code_verifier')

    if not code or not redirect_uri or not code_verifier:
        return jsonify({'error': 'Missing required fields'}), 400

    token_url = 'https://accounts.spotify.com/api/token'
    payload = {
        'client_id': os.environ.get('SPOTIFY_CLIENT_ID'),
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': redirect_uri,
        'code_verifier': code_verifier,
    }

    headers = {
        'Content-Type': 'application/x-www-form-urlencoded'
    }

    response = requests.post(token_url, data=payload, headers=headers)

    if response.status_code != 200:
        return jsonify({'error': 'Token exchange failed', 'details': response.json()}), 500

    return jsonify(response.json())