export async function GET() {
  const client_id = process.env.SPOTIFY_CLIENT_ID;
  
  return Response.json({
    client_id_length: client_id ? client_id.length : 'undefined',
    client_id_preview: client_id ? client_id.substring(0, 10) + '...' : 'undefined',
    has_newline: client_id ? client_id.includes('\n') : false,
    has_spaces: client_id ? client_id.includes(' ') : false,
    client_id_encoded: client_id ? JSON.stringify(client_id) : 'undefined'
  });
}