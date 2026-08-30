import { NextResponse } from 'next/server';
import MondayClient from '../../../../src/monday-client.js';

export async function POST(request) {
  try {
    const { mondayToken } = await request.json();
    if (!mondayToken) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }
    
    const client = new MondayClient(mondayToken);
    const user = await client.verifyConnection();
    
    // Fetch all boards to allow user to map them
    let boards = [];
    try {
      const data = await client.query('query { boards (limit: 100) { id name } }');
      boards = data.boards || [];
    } catch (e) {
      console.warn("Failed to fetch boards", e);
    }
    
    return NextResponse.json({ success: true, user, boards });
  } catch (error) {
    console.error('Monday check error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
