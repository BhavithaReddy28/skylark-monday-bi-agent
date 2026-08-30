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
        const dealBoards = data.boards.filter(b => b.name.toLowerCase().includes('deal') || b.name.toLowerCase().includes('funnel'));
        dealBoards.sort((a, b) => {
          const aIsSkylark = a.name === 'Skylark Deals';
          const bIsSkylark = b.name === 'Skylark Deals';
          if (aIsSkylark && !bIsSkylark) return 1;
          if (!aIsSkylark && bIsSkylark) return -1;
          return 0;
        });
        
        const woBoards = data.boards.filter(b => b.name.toLowerCase().includes('work') || b.name.toLowerCase().includes('order') || b.name.toLowerCase().includes('tracker'));
        woBoards.sort((a, b) => {
          const aIsSkylark = a.name === 'Skylark Work Orders';
          const bIsSkylark = b.name === 'Skylark Work Orders';
          if (aIsSkylark && !bIsSkylark) return 1;
          if (!aIsSkylark && bIsSkylark) return -1;
          return 0;
        });

        dId = dealBoards[0]?.id;
        wId = woBoards[0]?.id;
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
