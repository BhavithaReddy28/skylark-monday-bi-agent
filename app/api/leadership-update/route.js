import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { BIEngine } from '../../../src/bi-engine.js';
import MondayClient from '../../../src/monday-client.js';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { quarter, sector, mondayToken, geminiKey, useLiveMonday, dealsBoardId, woBoardId } = await request.json();
    
    const biEngine = new BIEngine();
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
      
      if (dId) deals = await client.getBoardItems(dId);
      if (wId) workOrders = await client.getBoardItems(wId);
    }
    
    
    const cleanDeals = biEngine.cleanDeals(deals);
    const cleanWOs = biEngine.cleanWorkOrders(workOrders);
    
    console.log('DEBUG DASHBOARD:', {
      dId: dealsBoardId,
      wId: woBoardId,
      hasToken: !!mondayToken,
      useLiveMonday,
      rawDealsLength: deals ? deals.length : 'null',
      rawWOsLength: workOrders ? workOrders.length : 'null',
      cleanDealsLength: cleanDeals.length,
      cleanWOsLength: cleanWOs.length,
    });
    
    if (deals && deals.length > 0) {
       console.log('DEBUG FIRST DEAL RAW:', JSON.stringify(deals[0]));
    }

    
    // Filter by sector if provided
    let filteredDeals = cleanDeals;
    let filteredWOs = cleanWOs;
    if (sector && sector !== '') {
      filteredDeals = filteredDeals.filter(d => (d.sector || '') === sector);
      filteredWOs = filteredWOs.filter(w => (w.sector || '') === sector);
    }
    
    

    // We could filter by quarter here, but we can also just pass the request to Gemini
    const performance = biEngine.getSectoralPerformance(filteredDeals, filteredWOs);
    const pipeline = biEngine.getPipelineHealth(filteredDeals);
    const revenue = biEngine.getRevenueMetrics(filteredWOs);

    const userApiKey = geminiKey || process.env.GEMINI_API_KEY;
    
    if (userApiKey) {
      try {
        const genAI = new GoogleGenerativeAI(userApiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        
        const dataContext = {
          metadata: { filterQuarter: quarter, filterSector: sector },
          revenue: revenue,
          pipeline: pipeline,
          performance: performance
        };

        const prompt = `
You are the Chief of Staff at Skylark Drones. Generate a formal, markdown-formatted executive leadership update.
Target Quarter: ${quarter || 'All Quarters'}
Target Sector: ${sector || 'All Sectors'}

Data Context:
${JSON.stringify(dataContext, null, 2)}

Format the report with these exact sections:
# Executive Summary
## Financial Highlights
## Pipeline & Sales Outlook
## Operational Execution
## Key Risks & Recommendations

Keep it professional, data-backed, and concise. Do NOT output a markdown code block wrapper around the whole response, just output the raw markdown text.
`;
        const result = await model.generateContent(prompt);
        return NextResponse.json({ success: true, report: result.response.text() });
      } catch (geminiErr) {
        console.error('Gemini API Error:', geminiErr);
        return NextResponse.json({ error: 'Failed to generate report via AI' }, { status: 500 });
      }
    } else {
       const fmt = (val) => `₹${(val / 1000000).toFixed(2)}M`;
       const fallbackReport = `
# Executive Summary (Auto-Generated)
_Note: Please add a Gemini API key in the sidebar for deep AI-driven insights. This is a basic data summary._

## Financial Highlights
- **Total Contract Value:** ${fmt(revenue.totalWOAmountExcl)}
- **Total Billed Value:** ${fmt(revenue.totalBilledValueExcl)}
- **Total Cash Collected:** ${fmt(revenue.totalCollectedValueIncl)}
- **Outstanding Accounts Receivable:** ${fmt(revenue.totalReceivables)}

## Pipeline & Sales Outlook
- **Total Open Pipeline Value:** ${fmt(pipeline.totalPipelineValue)}
- **Open Deals Count:** ${pipeline.openDealsCount}
- **High Probability Pipeline (>80%):** ${fmt(pipeline.byProbability.High || 0)}
- **Won Deals Count (YTD):** ${pipeline.wonDealsCount}

## Sectoral Performance
${Object.entries(performance.sectors || {}).map(([sec, data]) => `- **${sec}**: ${data.deals} Deals, ${data.wos} Work Orders`).join('\\n') || 'No sectoral data available.'}
       `;
       return NextResponse.json({ success: true, report: fallbackReport.trim() });
    }

  } catch (err) {
    console.error('Report error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
