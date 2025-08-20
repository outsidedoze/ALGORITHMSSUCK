export async function POST(request) {
  try {
    const data = await request.json();
    const { access_token } = data;

    const headers = {
      'Authorization': `Bearer ${access_token}`
    };

    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: headers
    });

    if (!response.ok) {
      const errorData = await response.json();
      return Response.json({
        error: 'Failed to fetch user profile',
        details: errorData
      }, { status: 400 });
    }

    const userData = await response.json();
    return Response.json(userData);
  } catch (error) {
    console.error('Error in me:', error);
    return Response.json({
      error: 'Internal server error',
      details: error.message
    }, { status: 500 });
  }
}