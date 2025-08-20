export async function GET() {
  return Response.json({
    message: 'Test endpoint working!',
    method: 'GET',
    timestamp: new Date().toISOString()
  });
}

export async function POST() {
  return Response.json({
    message: 'Test endpoint working!',
    method: 'POST',
    timestamp: new Date().toISOString()
  });
}