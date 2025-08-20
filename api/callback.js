export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, redirect_uri, code_verifier } = req.body;

    console.log('Received data:', { code, redirect_uri, code_verifier });

    if (!code || !redirect_uri || !code_verifier) {
      console.log('Missing required fields');
      return res.status(400).json({
        error: 'Missing required fields',
        received: req.body
      });
    }

    // Check if Spotify credentials are configured (fallback to frontend's public client_id)
    const client_id = process.env.SPOTIFY_CLIENT_ID || '2ee0d98b21d048978bf73d78924daf91';
    console.log('Using client_id:', client_id);

    const tokenUrl = 'https://accounts.spotify.com/api/token';
    const payload = new URLSearchParams({
      client_id: client_id,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirect_uri,
      code_verifier: code_verifier,
    });

    console.log('Sending to Spotify:', Object.fromEntries(payload));

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload,
    });

    console.log('Spotify response status:', response.status);
    const responseText = await response.text();
    console.log('Spotify response:', responseText);

    if (!response.ok) {
      const errorData = {
        error: 'Token exchange failed',
        status: response.status,
        response: responseText
      };
      
      try {
        errorData.details = JSON.parse(responseText);
      } catch {
        errorData.details = responseText;
      }
      
      return res.status(500).json(errorData);
    }

    const spotifyResponse = JSON.parse(responseText);
    console.log('Successfully got tokens:', Object.keys(spotifyResponse));
    
    return res.status(200).json(spotifyResponse);
  } catch (error) {
    console.error('Error in callback:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}