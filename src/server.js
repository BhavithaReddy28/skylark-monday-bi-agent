const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { BIEngine } = require('./bi-engine');
const MondayClient = require('./monday-client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const biEngine = new BIEngine();

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

// Helper to pull data from Monday boards
async function pullMondayData(mondayClient, dealsBoardId, woBoardId) {
  let deals = null;
  let workOrders = null;
  
  if (dealsBoardId) {
    try {
      deals = await mondayClient.getBoardItems(dealsBoardId);
      console.log(`Pulled ${deals.length} deals from Monday.com board ID ${dealsBoardId}`);
    } catch (e) {
      console.error(`Failed to pull deals from Monday: ${e.message}`);
    }
  }
  
  if (woBoardId) {
    try {
      workOrders = await mondayClient.getBoardItems(woBoardId);
      console.log(`Pulled ${workOrders.length} work orders from Monday.com board ID ${woBoardId}`);
    } catch (e) {
      console.error(`Failed to pull work orders from Monday: ${e.message}`);
    }
  }
  
  return { deals, workOrders };
}

// 1. Endpoint: Check Monday connection and boards status
app.post('/api/monday/check', async (req, res) => {
  const { mondayToken } = req.body;
  if (!mondayToken) {
    return res.status(400).json({ error: 'Monday.com Token is required' });
  }

  const client = new MondayClient(mondayToken);
  const conn = await client.verifyConnection();
  
  if (!conn.success) {
    return res.status(401).json({ error: conn.error });
  }

  const boards = await findSkylarkBoards(client);
  
  res.json({
    success: true,
    account: conn.account,
    boards
  });
});

// 2. Endpoint: Create boards and upload Excel data to Monday.com
app.post('/api/monday/sync', async (req, res) => {
  const { mondayToken } = req.body;
  if (!mondayToken) {
    return res.status(400).json({ error: 'Monday.com Token is required' });
  }

  const client = new MondayClient(mondayToken);
  const conn = await client.verifyConnection();
  
  if (!conn.success) {
    return res.status(401).json({ error: conn.error });
  }

  try {
    // Check if boards already exist to avoid duplicate board creation
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

    // Load and upload data if boards were just created
    let dealsUploaded = 0;
    let wosUploaded = 0;

    if (dealsCreated && biEngine.localDeals.length > 0) {
      dealsUploaded = await client.pushItems(dealsBoardId, biEngine.localDeals, false);
    }
    
    if (wosCreated && biEngine.localWorkOrders.length > 0) {
      wosUploaded = await client.pushItems(woBoardId, biEngine.localWorkOrders, true);
    }

    res.json({
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
    res.status(500).json({ error: err.message });
  }
});

// 3. Endpoint: Get data health status
app.get('/api/data/status', async (req, res) => {
  try {
    const report = biEngine.getDataQualityReport();
    res.json({
      success: true,
      report,
      localStats: {
        deals: biEngine.localDeals.length,
        workOrders: biEngine.localWorkOrders.length
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Endpoint: Conversational BI Agent Chat
app.post('/api/chat', async (req, res) => {
  const { message, mondayToken, geminiKey, useLiveMonday } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    // 1. Fetch relevant data
    let deals = null;
    let workOrders = null;
    
    if (useLiveMonday && mondayToken) {
      const client = new MondayClient(mondayToken);
      const boards = await findSkylarkBoards(client);
      const data = await pullMondayData(client, boards.dealsBoardId, boards.woBoardId);
      deals = data.deals;
      workOrders = data.workOrders;
    }
    
    // Clean data using BI Engine
    const cleanDeals = biEngine.cleanDeals(deals);
    const cleanWOs = biEngine.cleanWorkOrders(workOrders);
    
    // Aggregated state for context
    const performance = biEngine.getSectoralPerformance(deals, workOrders);
    const pipeline = biEngine.getPipelineHealth(deals);
    const revenue = biEngine.getRevenueMetrics(workOrders);
    const quality = biEngine.getDataQualityReport(deals, workOrders);

    // 2. Process using Gemini if key is provided
    const userApiKey = geminiKey || process.env.GEMINI_API_KEY;
    
    if (userApiKey) {
      try {
        const genAI = new GoogleGenerativeAI(userApiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        
        // Prepare context package
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
2. If there are missing fields or unlinked data, point out how this affects the quality of this answer (e.g., missing deal values or unlinked work orders).
3. Where helpful, structure key metrics in a markdown table or bullet points.
4. Keep the tone executive-ready: clear, objective, and strategic.
5. If the user asks for a chart/visualization or if a chart would make the answer much better, output a JSON block at the very end of your response inside \`\`\`chart ... \`\`\` tags indicating how to render it in this EXACT format:
\`\`\`chart
{
  "type": "bar", // or "line", "pie"
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
Choose colors from: '#22d3ee' (Cyan), '#3b82f6' (Blue), '#10b981' (Green), '#fbbf24' (Yellow), '#ef4444' (Red), '#a855f7' (Purple), '#6b7280' (Gray).
`;

        const result = await model.generateContent(prompt);
        let textResponse = result.response.text();
        
        // Parse custom chart JSON block from response text if present
        let chartData = null;
        let chartType = null;
        const chartMatch = textResponse.match(/```chart\s*([\s\S]*?)\s*```/);
        
        if (chartMatch) {
          try {
            const chartObj = JSON.parse(chartMatch[1]);
            chartData = chartObj.data;
            chartType = chartObj.type;
            // Clean the chart block out of textResponse so it doesn't show raw code to the user
            textResponse = textResponse.replace(/```chart\s*[\s\S]*?\s*```/, '').trim();
          } catch (e) {
            console.error('Failed to parse chart JSON from Gemini response:', e);
          }
        }

        return res.json({
          success: true,
          answer: textResponse,
          data: chartData,
          chartType: chartType,
          dataSource: useLiveMonday ? 'Monday.com API' : 'Local Excel Cache'
        });
      } catch (geminiErr) {
        console.error('Gemini API Error, falling back to rule engine:', geminiErr);
        // Fall through to rule-based engine
      }
    }

    // 3. Fallback to Rule-Based Semantic Engine
    console.log('Using Rule-Based Semantic Query Engine');
    const result = biEngine.answerNaturalQuery(message, deals, workOrders);
    res.json({
      success: true,
      answer: result.answer,
      data: result.data,
      chartType: result.chartType,
      dataSource: useLiveMonday ? 'Monday.com API' : 'Local Excel Cache',
      fallbackUsed: true
    });
  } catch (err) {
    console.error('Chat endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Endpoint: Get formatted leadership update report
app.post('/api/leadership-update', async (req, res) => {
  const { quarter, sector, mondayToken, useLiveMonday } = req.body;
  
  try {
    let deals = null;
    let workOrders = null;
    
    if (useLiveMonday && mondayToken) {
      const client = new MondayClient(mondayToken);
      const boards = await findSkylarkBoards(client);
      const data = await pullMondayData(client, boards.dealsBoardId, boards.woBoardId);
      deals = data.deals;
      workOrders = data.workOrders;
    }

    const report = biEngine.getLeadershipUpdate(deals, workOrders, quarter, sector);
    res.json({
      success: true,
      report
    });
  } catch (err) {
    console.error('Leadership update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Endpoint: Get dashboard aggregated data
app.post('/api/data/dashboard', async (req, res) => {
  const { mondayToken, useLiveMonday } = req.body;
  try {
    let deals = null;
    let workOrders = null;
    
    if (useLiveMonday && mondayToken) {
      const client = new MondayClient(mondayToken);
      const boards = await findSkylarkBoards(client);
      const data = await pullMondayData(client, boards.dealsBoardId, boards.woBoardId);
      deals = data.deals;
      workOrders = data.workOrders;
    }
    
    const performance = biEngine.getSectoralPerformance(deals, workOrders);
    const pipeline = biEngine.getPipelineHealth(deals);
    const revenue = biEngine.getRevenueMetrics(workOrders);
    const quality = biEngine.getDataQualityReport(deals, workOrders);
    const cleanWOs = biEngine.cleanWorkOrders(workOrders);
    
    res.json({
      success: true,
      performance,
      pipeline,
      revenue,
      quality,
      executionCount: {
        completed: cleanWOs.filter(w => w.status.toLowerCase() === 'completed').length,
        ongoing: cleanWOs.filter(w => w.status.toLowerCase() === 'ongoing').length,
        notStarted: cleanWOs.filter(w => w.status.toLowerCase() === 'not started').length,
        other: cleanWOs.filter(w => !['completed', 'ongoing', 'not started'].includes(w.status.toLowerCase())).length
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Monday BI Agent Server is running at http://localhost:${PORT}`);
  });
}

module.exports = app;
