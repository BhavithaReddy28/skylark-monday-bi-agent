import { NextResponse } from 'next/server';
import { BIEngine } from '../../../../src/bi-engine.js';
import MondayClient from '../../../../src/monday-client.js';

export const maxDuration = 60; // Allow Vercel to run up to 60s for sync

// Helper to find board IDs by name
async function findSkylarkBoards(mondayClient) {
  try {
    const data = await mondayClient.query('query { boards (limit: 100) { id name } }');
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

    return {
      dealsBoardId: dealBoards[0] ? dealBoards[0].id : null,
      woBoardId: woBoards[0] ? woBoards[0].id : null
    };
  } catch (err) {
    console.error('Error finding Monday boards:', err.message);
    return { dealsBoardId: null, woBoardId: null };
  }
}

export async function POST(request) {
  try {
    const { mondayToken } = await request.json();
    if (!mondayToken) {
      return NextResponse.json({ error: 'Monday.com Token is required' }, { status: 400 });
    }

    const client = new MondayClient(mondayToken);
    const conn = await client.verifyConnection();
    
    if (!conn.success) {
      return NextResponse.json({ error: conn.error }, { status: 401 });
    }

    const biEngine = new BIEngine(); // Loads local Excel data

    let boards = await findSkylarkBoards(client);
    let dealsBoardId = boards.dealsBoardId;
    let woBoardId = boards.woBoardId;
    
    let dealsCreated = false;
    let wosCreated = false;

    // Setup Deals Board
    if (!dealsBoardId) {
      console.log('Creating "Skylark Deals" board on Monday.com...');
      dealsBoardId = await client.createBoard('Skylark Deals');
      await client.setupDealsBoard(dealsBoardId);
      dealsCreated = true;
    }

    // Setup Work Orders Board
    if (!woBoardId) {
      console.log('Creating "Skylark Work Orders" board on Monday.com...');
      woBoardId = await client.createBoard('Skylark Work Orders');
      await client.setupWorkOrdersBoard(woBoardId);
      wosCreated = true;
    }

    let dealsUploaded = 0;
    let wosUploaded = 0;

    // Fast Batch Uploader
    async function batchPushItems(boardId, items, isWorkOrder = false) {
      const columns = await client.getBoardColumns(boardId);
      const titleToId = {};
      columns.forEach(c => titleToId[c.title] = c.id);

      const mutationTemplate = `
        mutation CreateItem($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
          create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
            id
          }
        }
      `;
      let successCount = 0;
      
      // Chunks of 15 requests at a time to avoid rate limits but bypass Vercel timeout
      const chunkSize = 15;
      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        
        const promises = chunk.map(async (item, idx) => {
          const name = item['Deal Name'] || item['Deal name masked'] || `Item ${i + idx + 1}`;
          const columnValuesObj = {};
          
          Object.keys(item).forEach(key => {
            const colId = titleToId[key];
            if (colId) {
              let val = item[key];
              if (val === null || val === undefined || val === '') return;
              const colType = columns.find(c => c.id === colId).type;
              
              if (colType === 'date') {
                if (typeof val === 'number') {
                  const d = new Date((val - 25569) * 86400 * 1000);
                  val = d.toISOString().split('T')[0];
                } else {
                  const match = String(val).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
                  if (match) {
                    val = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
                  } else { return; }
                }
                columnValuesObj[colId] = { date: val };
              } else if (colType === 'numbers') {
                let parsedNum = parseFloat(String(val).replace(/[\\$,\\s]/g, ''));
                if (!isNaN(parsedNum)) columnValuesObj[colId] = String(parsedNum);
              } else {
                columnValuesObj[colId] = String(val);
              }
            }
          });

          try {
            await client.query(mutationTemplate, {
              boardId,
              itemName: String(name),
              columnValues: JSON.stringify(columnValuesObj)
            });
            return true;
          } catch (e) {
            console.warn(`Failed to push item ${name}:`, e.message);
            return false;
          }
        });

        const results = await Promise.all(promises);
        successCount += results.filter(Boolean).length;
      }
      return successCount;
    }

    if (dealsCreated && biEngine.localDeals.length > 0) {
      dealsUploaded = await batchPushItems(dealsBoardId, biEngine.localDeals, false);
    }
    
    if (wosCreated && biEngine.localWorkOrders.length > 0) {
      wosUploaded = await batchPushItems(woBoardId, biEngine.localWorkOrders, true);
    }

    return NextResponse.json({
      success: true,
      dealsBoardId,
      woBoardId,
      dealsCreated,
      wosCreated,
      dealsUploaded,
      wosUploaded
    });
  } catch (err) {
    console.error('Error during Monday.com synchronization:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
