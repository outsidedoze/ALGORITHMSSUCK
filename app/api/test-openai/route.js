export async function GET() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      return Response.json({ error: 'No API key found' });
    }

    // Test the API key with a simple request
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    return Response.json({
      status: response.status,
      keyLength: apiKey.length,
      keyStart: apiKey.substring(0, 15),
      keyEnd: apiKey.substring(apiKey.length - 10),
      success: response.ok
    });

  } catch (error) {
    return Response.json({
      error: error.message,
      success: false
    });
  }
}