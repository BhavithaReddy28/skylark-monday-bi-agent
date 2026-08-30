import { NextResponse } from 'next/server';
import { BIEngine } from '../../../../src/bi-engine.js';
import MondayClient from '../../../../src/monday-client.js';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const body = await request.json();
    const { mondayToken, useLiveMonday, dealsBoardId, woBoardId } = body;
    
    let deals = null;
    let workOrders = null;
    
    if (useLiveMonday && mondayToken) {
      const client = new MondayClient(mondayToken);
      
      let dId = dealsBoardId;
      let wId = woBoardId;
      
      if (!dId && !wId) {
        const data = await client.query('query { boards (limit: 100) { id name } }');
        const dealsBoard = data.boards.find(b => b.name === 'Skylark Deals');
        const woBoard = data.boards.find(b => b.name === 'Skylark Work Orders');
        dId = dealsBoard?.id;
        wId = woBoard?.id;
      }
      
      if (dId) {
        deals = await client.getBoardItems(dId);
      }
      if (wId) {
        workOrders = await client.getBoardItems(wId);
      }
    }
    
    
    const biEngine = new BIEngine();
    
    console.log('DEBUG DASHBOARD ROUTE:', {
      dId: dealsBoardId,
      wId: woBoardId,
      hasToken: !!mondayToken,
      useLiveMonday,
      rawDealsLength: deals ? deals.length : 'null',
      rawWOsLength: workOrders ? workOrders.length : 'null',
    });

    if (useLiveMonday && deals && workOrders) {

      console.log('DEBUG WORKORDER[0]:', JSON.stringify(workOrders[0]));
      console.log('DEBUG DEAL[0]:', JSON.stringify(deals[0]));
      biEngine.localDeals = biEngine.cleanDeals(deals);
      biEngine.localWOs = biEngine.cleanWorkOrders(workOrders);
    }
    
    const metrics = biEngine.calculateKPIs();
    return NextResponse.json({ metrics, status: 'success' });
  } catch (err) {
    console.error('Error fetching dashboard data:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
