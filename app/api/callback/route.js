export async function POST(request) {
  try {
    const data = await request.json();
    const { code, redirect_uri, code_verifier } = data;

    console.log('Received data:', { code, redirect_uri, code_verifier });

    if (!code || !redirect_uri || !code_verifier) {
      console.log('Missing required fields');
      return Response.json({
        error: 'Missing required fields',
        received: data
      }, { status: 400 });
    }

    // Check if Spotify credentials are configured (fallback to frontend's public client_id)
    const client_id = (process.env.SPOTIFY_CLIENT_ID || '2ee0d98b21d048978bf73d78924daf91').trim();
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
      body: payload.toString(),
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
      
      return Response.json(errorData, { status: 500 });
    }

    const spotifyResponse = JSON.parse(responseText);
    console.log('Successfully got tokens:', Object.keys(spotifyResponse));
    
    return Response.json(spotifyResponse);
  } catch (error) {
    console.error('Error in callback:', error);
    return Response.json({
      error: 'Internal server error',
      details: error.message
    }, { status: 500 });
  }
}