export async function GET() {
  const client_id = process.env.SPOTIFY_CLIENT_ID;
  const openai_key = process.env.OPENAI_API_KEY;
  
  return Response.json({
    client_id_length: client_id ? client_id.length : 'undefined',
    client_id_preview: client_id ? client_id.substring(0, 10) + '...' : 'undefined',
    has_newline: client_id ? client_id.includes('\n') : false,
    has_spaces: client_id ? client_id.includes(' ') : false,
    client_id_encoded: client_id ? JSON.stringify(client_id) : 'undefined',
    openai_key_length: openai_key ? openai_key.length : 'undefined',
    openai_key_preview: openai_key ? openai_key.substring(0, 10) + '...' : 'undefined',
    openai_key_has_newline: openai_key ? openai_key.includes('\n') : false,
    openai_key_has_spaces: openai_key ? openai_key.includes(' ') : false,
    openai_key_full_encoded: openai_key ? JSON.stringify(openai_key) : 'undefined'
  });
}