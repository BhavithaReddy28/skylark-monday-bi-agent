import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { BIEngine } from '../../../src/bi-engine.js';
import MondayClient from '../../../src/monday-client.js';

// Helper to find board IDs by name
async function findSkylarkBoards(mondayClient) {
  try {
    const data = await mondayClient.query('query { boards (limit: 100) { id name } }');
    const dealsBoard = data.boards.find(b => b.name === 'Skylark Deals');
    const woBoard = data.boards.find(b => b.name === 'Skylark Work Orders');
    return {
      dealsBoardId: dealsBoard ? dealsBoard.id : null,
      woBoardId: woBoard ? woBoard.id : null
    };
  } catch (err) {
    console.error('Error finding Monday boards:', err.message);
    return { dealsBoardId: null, woBoardId: null };
  }
}

async function pullMondayData(mondayClient, dealsBoardId, woBoardId) {
  let deals = null;
  let workOrders = null;
  if (dealsBoardId) deals = await mondayClient.getBoardItems(dealsBoardId);
  if (woBoardId) workOrders = await mondayClient.getBoardItems(woBoardId);
  return { deals, workOrders };
}

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { message, mondayToken, geminiKey, useLiveMonday, dealsBoardId, woBoardId } = await request.json();
    
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const biEngine = new BIEngine();
    let deals = null;
    let workOrders = null;
    
    if (useLiveMonday && mondayToken) {
      const client = new MondayClient(mondayToken);
      let dId = dealsBoardId;
      let wId = woBoardId;
      if (!dId && !wId) {
        const boards = await findSkylarkBoards(client);
        dId = boards.dealsBoardId;
        wId = boards.woBoardId;
      }
      const data = await pullMondayData(client, dId, wId);
      deals = data.deals;
      workOrders = data.workOrders;
    }
    
    const cleanDeals = biEngine.cleanDeals(deals);
    const cleanWOs = biEngine.cleanWorkOrders(workOrders);
    
    const performance = biEngine.getSectoralPerformance(deals, workOrders);
    const pipeline = biEngine.getPipelineHealth(deals);
    const revenue = biEngine.getRevenueMetrics(workOrders);
    const quality = biEngine.getDataQualityReport(deals, workOrders);

    const userApiKey = process.env.GEMINI_API_KEY;
    
    if (userApiKey) {
      try {
        const genAI = new GoogleGenerativeAI(userApiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
        
        const dataContext = {
          metadata: {
            source: useLiveMonday ? "Live Monday.com Boards" : "Cleaned Local Excel Sheets",
            timestamp: new Date().toISOString(),
            recordCounts: { deals: cleanDeals.length, workOrders: cleanWOs.length }
          },
          financialMetrics: {
            totalWOAmountExcl: revenue.totalWOAmountExcl,
            totalBilledValueExcl: revenue.totalBilledValueExcl,
            totalCollectedValueIncl: revenue.totalCollectedValueIncl,
            totalOutstandingAR: revenue.totalReceivables,
            highPriorityAR: revenue.highPriorityReceivables
          },
          pipelineStatus: {
            openPipelineValue: pipeline.totalPipelineValue,
            weightedPipelineValue: pipeline.totalWeightedPipeline,
            wonValue: pipeline.wonDealsValue,
            stages: pipeline.byStage,
            sectors: pipeline.bySector,
            probabilities: pipeline.byProbability
          },
          sectoralDetails: performance,
          dataQuality: quality
        };

        const prompt = `
You are the Skylark Drones Business Intelligence Agent, an expert virtual CFO and operations assistant.
You help founders and executives analyze their sales pipeline, project execution status, and financial collections.

Below is the verified and cleaned aggregate data context:
\`\`\`json
${JSON.stringify(dataContext, null, 2)}
\`\`\`

Here is the founder's query: "${message}"

Write a highly professional, accurate, and detailed business response.
Guidelines:
1. Answer the query directly and back it up with calculations from the data context.
2. If there are missing fields or unlinked data, point out how this affects the quality of this answer.
3. Where helpful, structure key metrics in a markdown table or bullet points.
4. Keep the tone executive-ready: clear, objective, and strategic.
5. If the user asks for a chart/visualization, output a JSON block at the very end of your response inside \`\`\`chart ... \`\`\` tags indicating how to render it in this EXACT format:
\`\`\`chart
{
  "type": "bar",
  "data": {
    "labels": ["Label1", "Label2"],
    "datasets": [{
      "label": "Metric Title",
      "data": [100, 200],
      "backgroundColor": ["#3b82f6", "#ef4444"]
    }]
  }
}
\`\`\`
Choose colors from: '#22d3ee', '#3b82f6', '#10b981', '#fbbf24', '#ef4444', '#a855f7', '#6b7280'.
`;
        const result = await model.generateContent(prompt);
        let textResponse = result.response.text();
        
        let chartData = null;
        let chartType = null;
        const chartMatch = textResponse.match(/```chart\s*([\s\S]*?)\s*```/);
        
        if (chartMatch) {
          try {
            const chartObj = JSON.parse(chartMatch[1]);
            chartData = chartObj.data;
            chartType = chartObj.type;
            textResponse = textResponse.replace(/```chart\s*[\s\S]*?\s*```/, '').trim();
          } catch (e) {
            console.error('Failed to parse chart JSON:', e);
          }
        }

        return NextResponse.json({
          success: true,
          answer: textResponse,
          data: chartData,
          chartType: chartType,
          dataSource: useLiveMonday ? 'Monday.com API' : 'Local Excel Cache'
        });
      } catch (geminiError) {
        console.error('Gemini error:', geminiError);
        return NextResponse.json({ error: 'Gemini Error: ' + geminiError.message, stack: geminiError.stack }, { status: 500 });
      }
    } else {
      // Rule-based processing when no AI key is provided
      const fallbackAns = biEngine.answerNaturalQuery(message, cleanDeals, cleanWOs);
      if (typeof fallbackAns === 'object' && fallbackAns.answer) {
          return NextResponse.json(fallbackAns);
      }
      return NextResponse.json({ answer: fallbackAns });
    }
  } catch (err) {
    console.error('Chat error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
