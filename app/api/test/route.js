import { NextResponse } from 'next/server';
import MondayClient from '../../../src/monday-client.js';

export async function POST(request) {
  try {
    const { mondayToken, dealsBoardId, woBoardId } = await request.json();
    const client = new MondayClient(mondayToken);
    
    let deals = [];
    let wos = [];
    if (dealsBoardId) deals = await client.getBoardItems(dealsBoardId);
    if (woBoardId) wos = await client.getBoardItems(woBoardId);
    
    const apiKey = process.env.GEMINI_API_KEY || '';
    return NextResponse.json({ 
      dealsItem: deals[0] || null,
      wosItem: wos[0] || null,
      keys: wos[0] ? Object.keys(wos[0]) : [],
      hasGeminiKey: !!apiKey,
      keyEndsWith: apiKey.slice(-4)

    });
  } catch (err) {
    return NextResponse.json({ error: err.message });
  }
}
