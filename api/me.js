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
    const { access_token } = req.body;

    const headers = {
      'Authorization': `Bearer ${access_token}`
    };

    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: headers
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res.status(400).json({
        error: 'Failed to fetch user profile',
        details: errorData
      });
    }

    const userData = await response.json();
    return res.status(200).json(userData);
  } catch (error) {
    console.error('Error in me:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}