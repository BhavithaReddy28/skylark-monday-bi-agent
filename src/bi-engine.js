import * as xlsx from 'xlsx';
import path from 'path';
import fs from 'fs';

// Helper to parse dates from Excel
function parseExcelDate(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    // Excel serial dates (days since Dec 30, 1899 due to Excel leap year bug)
    try {
      const date = new Date((val - 25569) * 86400 * 1000);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } catch (e) {}
  }
  const str = String(val).trim();
  if (!str || str.toLowerCase() === 'nan' || str.toLowerCase() === 'null') return null;
  
  // Try matching standard YYYY-MM-DD
  const match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) {
    const y = match[1];
    const m = match[2].padStart(2, '0');
    const d = match[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  
  // Try standard JS Date parsing
  try {
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (e) {}
  
  return str;
}

// Helper to parse numbers
function parseExcelNumber(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  // Strip everything except digits, minus sign, and period
  const str = String(val).replace(/[^\d\.-]/g, '').trim();
  if (!str || str.toLowerCase() === 'nan' || str.toLowerCase() === 'null') return 0;
  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : parsed;
}

// Helper to parse numeric quantities (e.g., "5360 HA", "4")
function parseQuantity(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const str = String(val).replace(/,/g, '').trim();
  const match = str.match(/[\d\.]+/);
  if (match) {
    return parseFloat(match[0]);
  }
  return 0;
}

// Sector normalizer
function normalizeSector(sec) {
  if (!sec) return 'Others';
  const s = String(sec).trim().toLowerCase();
  if (s.includes('mining')) return 'Mining';
  if (s.includes('renewable') || s.includes('wind') || s.includes('solar') || s.includes('energy')) return 'Renewables';
  if (s.includes('rail')) return 'Railways';
  if (s.includes('powerline') || s.includes('power line')) return 'Powerline';
  if (s.includes('construction')) return 'Construction';
  if (s.includes('aviation')) return 'Aviation';
  if (s.includes('manufacturing')) return 'Manufacturing';
  return 'Others';
}

// Extract Quarter and Year
function getQuarterAndYear(dateStr) {
  if (!dateStr) return { quarter: 'Unknown', year: 'Unknown', key: 'Unknown' };
  const parts = dateStr.split('-');
  if (parts.length < 2) return { quarter: 'Unknown', year: 'Unknown', key: 'Unknown' };
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (isNaN(year) || isNaN(month)) return { quarter: 'Unknown', year: 'Unknown', key: 'Unknown' };
  
  let qNum = 1;
  if (month >= 4 && month <= 6) qNum = 2;
  else if (month >= 7 && month <= 9) qNum = 3;
  else if (month >= 10 && month <= 12) qNum = 4;
  
  return {
    quarter: `Q${qNum}`,
    year: String(year),
    key: `${year}-Q${qNum}`
  };
}

// Load Excel File and parse
function loadExcelFile(filePath, isWorkOrder = false) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at ${filePath}`);
  }
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  let rawData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
  
  if (rawData.length === 0) return [];
  
  let headerIndex = 0;
  while (headerIndex < rawData.length && (!rawData[headerIndex] || rawData[headerIndex].length === 0 || rawData[headerIndex].every(v => v === null || v === undefined || String(v).trim() === ''))) {
    headerIndex++;
  }
  if (headerIndex >= rawData.length) return [];
  
  let headers = rawData[headerIndex].map(h => String(h || '').trim());
  let dataRows = rawData.slice(headerIndex + 1);
  
  const cleanedData = [];
  
  for (const row of dataRows) {
    if (row.length === 0) continue;
    
    const item = {};
    let hasValue = false;
    for (let i = 0; i < headers.length; i++) {
      const headerName = headers[i];
      if (!headerName) continue;
      const cellValue = row[i];
      item[headerName] = cellValue !== undefined ? cellValue : null;
      if (cellValue !== null && cellValue !== undefined && cellValue !== '') {
        hasValue = true;
      }
    }
    
    // Filter out rows that duplicate headers
    const firstVal = String(row[0] || '');
    if (firstVal === 'Deal name masked' || firstVal === 'Deal Name' || firstVal === 'Unnamed: 0') {
      continue;
    }
    
    if (hasValue) {
      cleanedData.push(item);
    }
  }
  
  return cleanedData;
}

class BIEngine {
  constructor() {
    this.localDeals = [];
    this.localWorkOrders = [];
    this.loadLocalData();
  }
  
  loadLocalData() {
    try {
      // In Next.js/ESM, process.cwd() points to the root directory
      const dealsPath = path.join(process.cwd(), 'Deal funnel Data.xlsx');
      const woPath = path.join(process.cwd(), 'Work_Order_Tracker Data.xlsx');
      this.localDeals = loadExcelFile(dealsPath, false);
      this.localWorkOrders = loadExcelFile(woPath, true);
      console.log(`BIEngine: Loaded ${this.localDeals.length} deals and ${this.localWorkOrders.length} work orders from local Excel files.`);
    } catch (err) {
      console.error('BIEngine error loading local files:', err);
    }
  }
  
  // Helper for fuzzy key matching from user-uploaded Monday boards
  findKey(item, keywords, ignoreWords = []) {
    const keys = Object.keys(item);
    
    // Helper to check if key should be ignored
    const isIgnored = (k) => {
      const lowerK = k.toLowerCase();
      return ignoreWords.some(ignore => lowerK.includes(ignore.toLowerCase()));
    };
    
    // First pass: exact match (case insensitive)
    for (const kw of keywords) {
      const lowerKw = kw.toLowerCase().replace(/[^a-z0-9]/g, '');
      const exactMatch = keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === lowerKw && !isIgnored(k));
      if (exactMatch && item[exactMatch] !== undefined && item[exactMatch] !== null && item[exactMatch] !== '') return item[exactMatch];
    }
    
    // Second pass: includes match
    for (const kw of keywords) {
      const lowerKw = kw.toLowerCase().replace(/[^a-z0-9]/g, '');
      const match = keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '').includes(lowerKw) && !isIgnored(k));
      if (match && item[match] !== undefined && item[match] !== null && item[match] !== '') return item[match];
    }
    
    return null;
  }

  // Standardize Deals Array
  cleanDeals(dealsInput) {
    const list = dealsInput || this.localDeals;
    if (!list || list.length === 0) return [];
    if (list[0]._isClean) return list;
    
    return list.map(item => {
      const name = this.findKey(item, ['deal name', 'name', 'deal']) || '';
      const owner = this.findKey(item, ['owner code', 'owner']) || 'Unknown';
      const client = this.findKey(item, ['client code', 'client']) || 'Unknown';
      const status = this.findKey(item, ['deal status', 'status']) || 'Unknown';
      const closeDate = parseExcelDate(this.findKey(item, ['close date', 'closedate']));
      const prob = this.findKey(item, ['closure probability', 'probability', 'prob']);
      const val = parseExcelNumber(this.findKey(item, ['masked deal value', 'deal value', 'deal amount', 'amount', 'value'], ['prob']));
      const tentCloseDate = parseExcelDate(this.findKey(item, ['tentative close date', 'tentative']));
      const stage = this.findKey(item, ['deal stage', 'stage']) || 'Unknown';
      const product = this.findKey(item, ['product deal', 'product']) || 'Unknown';
      const sector = normalizeSector(this.findKey(item, ['sector/service', 'sector']));
      const createdDate = parseExcelDate(this.findKey(item, ['created date', 'created']));
      
      let probValue = 0.3; // default for unknown/null
      if (prob) {
        const pStr = String(prob).toLowerCase();
        if (pStr.includes('high')) probValue = 0.9;
        else if (pStr.includes('medium')) probValue = 0.5;
        else if (pStr.includes('low')) probValue = 0.15;
      }
      if (status.toLowerCase() === 'won' || stage.toLowerCase().includes('won') || stage.toLowerCase().includes('work order received')) {
        probValue = 1.0;
      } else if (status.toLowerCase() === 'dead' || stage.toLowerCase().includes('lost')) {
        probValue = 0.0;
      }
      
      const closeQ = getQuarterAndYear(closeDate || tentCloseDate);
      const createdQ = getQuarterAndYear(createdDate);
      
      return {
        _isClean: true,
        name, owner, client, status, closeDate, prob, probValue, val,
        tentCloseDate, stage, product, sector, createdDate,
        quarter: closeQ.quarter, year: closeQ.year, quarterKey: closeQ.key,
        createdQuarter: createdQ.quarter, createdYear: createdQ.year
      };
    }).filter(d => d.name && d.name !== 'Deal Name');
  }
  
  // Standardize Work Orders Array
  cleanWorkOrders(woInput) {
    const list = woInput || this.localWorkOrders;
    if (!list || list.length === 0) return [];
    if (list[0]._isClean) return list;

    return list.map(item => {
      const name = this.findKey(item, ['deal name masked', 'deal name', 'name', 'deal']) || '';
      const client = this.findKey(item, ['customer name code', 'customer name', 'client code', 'client']) || 'Unknown';
      const serial = this.findKey(item, ['serial #', 'serial', 'id']) || 'Unknown';
      const nature = this.findKey(item, ['nature of work', 'nature']) || 'Unknown';
      const status = this.findKey(item, ['execution status', 'status']) || 'Unknown';
      const deliveryDate = parseExcelDate(this.findKey(item, ['data delivery date', 'delivery date', 'delivery']));
      const poDate = parseExcelDate(this.findKey(item, ['date of po', 'po date', 'po']));
      const sector = normalizeSector(this.findKey(item, ['sector/service', 'sector']));
      const typeOfWork = this.findKey(item, ['type of work', 'type']) || 'Unknown';
      
      const amtExcl = parseExcelNumber(this.findKey(item, ['amount in rupees (excl', 'amount in rupees excl', 'amount excl', 'excl gst', 'amount', 'value'], ['prob', 'billed', 'collected', 'receivable']));
      const amtIncl = parseExcelNumber(this.findKey(item, ['amount in rupees (incl', 'amount in rupees incl', 'amount incl', 'incl gst', 'value'], ['prob', 'billed', 'collected', 'receivable']));
      const billedExcl = parseExcelNumber(this.findKey(item, ['billed value in rupees (excl', 'billed value excl', 'billed excl', 'value'], ['prob', 'collected', 'receivable']));
      const billedIncl = parseExcelNumber(this.findKey(item, ['billed value in rupees (incl', 'billed value incl', 'billed incl', 'billed value', 'value'], ['prob', 'collected', 'receivable', 'excl']));
      const collected = parseExcelNumber(this.findKey(item, ['collected amount in rupees', 'collected amount', 'collected', 'collection']));
      const receivables = parseExcelNumber(this.findKey(item, ['amount receivable', 'receivable', 'ar']));
      const arPriority = this.findKey(item, ['ar priority account', 'ar priority', 'priority']) || 'Normal';
      
      const qtyOps = parseQuantity(this.findKey(item, ['quantity by ops', 'qty ops', 'ops qty']));
      const qtyPo = parseQuantity(this.findKey(item, ['quantities as per po', 'qty po', 'po qty']));
      const qtyBilled = parseQuantity(this.findKey(item, ['quantity billed', 'qty billed', 'billed qty']));
      
      const invoiceStatus = this.findKey(item, ['invoice status', 'invoice']) || 'Unknown';
      const expectedBillingMonth = this.findKey(item, ['expected billing month', 'expected billing']) || 'Unknown';
      const actualBillingMonth = this.findKey(item, ['actual billing month', 'actual billing']) || 'Unknown';
      const actualCollectionMonth = this.findKey(item, ['actual collection month', 'actual collection']) || 'Unknown';
      
      const deliveryQ = getQuarterAndYear(deliveryDate);
      const poQ = getQuarterAndYear(poDate);
      
      return {
        _isClean: true,
        name, client, serial, nature, status, deliveryDate, poDate, sector, typeOfWork,
        amtExcl, amtIncl, billedExcl, billedIncl, collected, receivables, arPriority,
        qtyOps, qtyPo, qtyBilled, invoiceStatus, expectedBillingMonth, actualBillingMonth,
        actualCollectionMonth,
        quarter: poQ.quarter || deliveryQ.quarter || 'Unknown',
        year: poQ.year || deliveryQ.year || 'Unknown',
        quarterKey: poQ.key || deliveryQ.key || 'Unknown'
      };
    }).filter(w => w.name && w.name !== 'Deal name masked');
  }

  // Dashboard API Aggregator
  calculateKPIs(dealsInput, woInput) {
    const deals = dealsInput || this.localDeals || [];
    const wos = woInput || this.localWOs || [];
    
    // Status aggregation for work orders
    const byStatus = {};
    wos.forEach(w => {
      const stat = w.status || 'Unknown';
      byStatus[stat] = (byStatus[stat] || 0) + 1;
    });

    return {
      revenue: this.getRevenueMetrics(wos),
      pipeline: this.getPipelineHealth(deals),
      sectoral: this.getSectoralPerformance(deals, wos),
      quality: this.getDataQualityReport(deals, wos),
      workOrders: {
        byStatus
      }
    };
  }

  // Core Calculations: Sectoral performance
  getSectoralPerformance(dealsInput, woInput) {
    const deals = this.cleanDeals(dealsInput);
    const wos = this.cleanWorkOrders(woInput);
    
    const sectors = ['Mining', 'Renewables', 'Railways', 'Powerline', 'Construction', 'Others'];
    const performance = {};
    
    sectors.forEach(sec => {
      performance[sec] = {
        sector: sec,
        dealsCount: 0,
        wonCount: 0,
        wonValue: 0,
        pipelineValue: 0,
        weightedPipeline: 0,
        workOrdersCount: 0,
        completedWOs: 0,
        revenueBilled: 0,
        revenueCollected: 0,
        receivables: 0
      };
    });
    
    deals.forEach(d => {
      const sec = d.sector;
      if (!performance[sec]) return;
      performance[sec].dealsCount += 1;
      
      if (d.status.toLowerCase() === 'won' || d.stage.toLowerCase().includes('won') || d.stage.toLowerCase().includes('work order received')) {
        performance[sec].wonCount += 1;
        performance[sec].wonValue += d.val;
      } else if (d.status.toLowerCase() === 'open') {
        performance[sec].pipelineValue += d.val;
        performance[sec].weightedPipeline += d.val * d.probValue;
      }
    });
    
    wos.forEach(w => {
      const sec = w.sector;
      if (!performance[sec]) return;
      performance[sec].workOrdersCount += 1;
      if (w.status.toLowerCase() === 'completed') {
        performance[sec].completedWOs += 1;
      }
      performance[sec].revenueBilled += w.billedExcl;
      performance[sec].revenueCollected += w.collected / 1.18; // approx excl GST
      performance[sec].receivables += w.receivables;
    });
    
    return Object.values(performance);
  }
  
  // Pipeline Health Metrics
  getPipelineHealth(dealsInput, selectedQuarter = null) {
    const deals = this.cleanDeals(dealsInput);
    
    let filteredDeals = deals;
    if (selectedQuarter) {
      filteredDeals = deals.filter(d => d.quarterKey === selectedQuarter || d.quarter === selectedQuarter);
    }
    
    const pipeline = {
      totalPipelineValue: 0,
      totalWeightedPipeline: 0,
      openDealsCount: 0,
      wonDealsCount: 0,
      wonDealsValue: 0,
      lostDealsCount: 0,
      lostDealsValue: 0,
      byStage: {},
      bySector: {},
      byProbability: { High: 0, Medium: 0, Low: 0, Won: 0, Lost: 0 }
    };
    
    filteredDeals.forEach(d => {
      const val = d.val;
      const stage = d.stage;
      const sector = d.sector;
      
      if (d.status.toLowerCase() === 'won' || stage.toLowerCase().includes('won') || stage.toLowerCase().includes('work order received')) {
        pipeline.wonDealsCount += 1;
        pipeline.wonDealsValue += val;
        pipeline.byProbability.Won += val;
      } else if (d.status.toLowerCase() === 'dead' || stage.toLowerCase().includes('lost')) {
        pipeline.lostDealsCount += 1;
        pipeline.lostDealsValue += val;
        pipeline.byProbability.Lost += val;
      } else {
        // Open pipeline
        pipeline.openDealsCount += 1;
        pipeline.totalPipelineValue += val;
        pipeline.totalWeightedPipeline += val * d.probValue;
        
        // Stage aggregation
        if (!pipeline.byStage[stage]) pipeline.byStage[stage] = { count: 0, val: 0, weightedVal: 0 };
        pipeline.byStage[stage].count += 1;
        pipeline.byStage[stage].val += val;
        pipeline.byStage[stage].weightedVal += val * d.probValue;
        
        // Sector aggregation
        if (!pipeline.bySector[sector]) pipeline.bySector[sector] = { count: 0, val: 0, weightedVal: 0 };
        pipeline.bySector[sector].count += 1;
        pipeline.bySector[sector].val += val;
        pipeline.bySector[sector].weightedVal += val * d.probValue;
        
        // Probability aggregation
        if (d.probValue >= 0.8) pipeline.byProbability.High += val;
        else if (d.probValue >= 0.4) pipeline.byProbability.Medium += val;
        else pipeline.byProbability.Low += val;
      }
    });
    
    return pipeline;
  }
  
  // Revenue & AR Metrics
  getRevenueMetrics(woInput) {
    const wos = this.cleanWorkOrders(woInput);
    
    let totalWOAmountExcl = 0;
    let totalBilledValueExcl = 0;
    let totalCollectedValueIncl = 0;
    let totalReceivables = 0;
    let highPriorityReceivables = 0;
    
    const bySector = {};
    const billingStatusCount = {};
    const collectionStatusCount = {};
    
    wos.forEach(w => {
      totalWOAmountExcl += w.amtExcl;
      totalBilledValueExcl += w.billedExcl;
      totalCollectedValueIncl += w.collected;
      totalReceivables += w.receivables;
      
      const isHighPriority = String(w.arPriority).toLowerCase().includes('high') || 
                             String(w.arPriority).toLowerCase().includes('p0') ||
                             String(w.arPriority).toLowerCase().includes('priority') ||
                             w.receivables > 1000000; // auto-elevate large receivables
      
      if (isHighPriority && w.receivables > 0) {
        highPriorityReceivables += w.receivables;
      }
      
      const sec = w.sector;
      if (!bySector[sec]) {
        bySector[sec] = {
          amtExcl: 0, billedExcl: 0, collectedIncl: 0, receivables: 0, count: 0
        };
      }
      bySector[sec].amtExcl += w.amtExcl;
      bySector[sec].billedExcl += w.billedExcl;
      bySector[sec].collectedIncl += w.collected;
      bySector[sec].receivables += w.receivables;
      bySector[sec].count += 1;
      
      const invStatus = w.invoiceStatus || 'Unknown';
      billingStatusCount[invStatus] = (billingStatusCount[invStatus] || 0) + 1;
      
      const collStatus = w.actualCollectionMonth && w.actualCollectionMonth !== 'Unknown' ? 'Collected' : 'Pending';
      collectionStatusCount[collStatus] = (collectionStatusCount[collStatus] || 0) + 1;
    });
    
    return {
      totalWOAmountExcl,
      totalBilledValueExcl,
      totalCollectedValueIncl,
      totalReceivables,
      highPriorityReceivables,
      bySector,
      billingStatusCount,
      collectionStatusCount
    };
  }
  
  // Data Quality Metrics
  getDataQualityReport(dealsInput, woInput) {
    const rawDeals = dealsInput || this.localDeals;
    const rawWOs = woInput || this.localWorkOrders;
    
    const dealErrors = {
      missingValue: 0,
      missingDate: 0,
      invalidSector: 0,
      duplicateHeaderRows: 0,
      total: rawDeals.length
    };
    
    rawDeals.forEach(rawD => {
      const name = rawD['Deal Name'];
      if (name === 'Deal Name' || name === 'Deal name masked') {
        dealErrors.duplicateHeaderRows += 1;
      }
    });

    const cleanD = this.cleanDeals(dealsInput);
    cleanD.forEach(d => {
      if (!d.val && d.val !== 0) dealErrors.missingValue += 1;
      if (!d.closeDate && !d.tentCloseDate) dealErrors.missingDate += 1;
      if (d.sector === 'Others') dealErrors.invalidSector += 1;
    });
    
    const woErrors = {
      missingAmount: 0,
      missingDates: 0,
      unlinkedDeals: 0,
      duplicateHeaderRows: 0,
      total: rawWOs.length
    };
    

    const dealNames = new Set(cleanD.map(d => d.name));
    
    rawWOs.forEach(rawW => {
      const name = rawW['Deal name masked'];
      if (name === 'Deal name masked' || name === 'Deal Name') {
        woErrors.duplicateHeaderRows += 1;
      }
    });

    const cleanW = this.cleanWorkOrders(woInput);
    cleanW.forEach(w => {
      if (!w.amtExcl && w.amtExcl !== 0) woErrors.missingAmount += 1;
      if (!w.deliveryDate && !w.poDate) woErrors.missingDates += 1;
      if (w.name && !dealNames.has(w.name)) woErrors.unlinkedDeals += 1;
    });
    
    return {
      deals: dealErrors,
      workOrders: woErrors,
      score: Math.max(0, 100 - (
        (dealErrors.missingValue + dealErrors.missingDate + woErrors.missingAmount + woErrors.unlinkedDeals) / 
        (rawDeals.length + rawWOs.length) * 100
      )).toFixed(1)
    };
  }

  // Generate Leadership updates
  getLeadershipUpdate(dealsInput, woInput, quarter = null, sector = null) {
    const deals = this.cleanDeals(dealsInput);
    const wos = this.cleanWorkOrders(woInput);
    
    // Filter data based on parameters
    let filteredDeals = deals;
    let filteredWOs = wos;
    
    if (quarter) {
      filteredDeals = deals.filter(d => d.quarterKey === quarter || d.quarter === quarter);
      filteredWOs = wos.filter(w => w.quarterKey === quarter || w.quarter === quarter);
    }
    
    if (sector) {
      filteredDeals = filteredDeals.filter(d => d.sector.toLowerCase() === sector.toLowerCase());
      filteredWOs = filteredWOs.filter(w => w.sector.toLowerCase() === sector.toLowerCase());
    }
    
    // Aggregate values
    const wonDeals = filteredDeals.filter(d => d.status.toLowerCase() === 'won');
    const openDeals = filteredDeals.filter(d => d.status.toLowerCase() === 'open');
    
    const totalWonVal = wonDeals.reduce((sum, d) => sum + d.val, 0);
    const totalOpenVal = openDeals.reduce((sum, d) => sum + d.val, 0);
    const weightedOpenVal = openDeals.reduce((sum, d) => sum + d.val * d.probValue, 0);
    
    const woTotalVal = filteredWOs.reduce((sum, w) => sum + w.amtExcl, 0);
    const woBilledVal = filteredWOs.reduce((sum, w) => sum + w.billedExcl, 0);
    const woCollectedVal = filteredWOs.reduce((sum, w) => sum + w.collected, 0);
    const woReceivables = filteredWOs.reduce((sum, w) => sum + w.receivables, 0);
    
    const completedWOsCount = filteredWOs.filter(w => w.status.toLowerCase() === 'completed').length;
    
    // Sector-specific breakdown
    const sectorStats = {};
    filteredDeals.forEach(d => {
      if (!sectorStats[d.sector]) sectorStats[d.sector] = { won: 0, open: 0, openWeighted: 0 };
      if (d.status.toLowerCase() === 'won') sectorStats[d.sector].won += d.val;
      else if (d.status.toLowerCase() === 'open') {
        sectorStats[d.sector].open += d.val;
        sectorStats[d.sector].openWeighted += d.val * d.probValue;
      }
    });
    
    const quality = this.getDataQualityReport(dealsInput, woInput);
    
    const qTitle = quarter ? `for ${quarter}` : 'Overall';
    const sTitle = sector ? `${sector} Sector` : 'All Sectors';
    
    const markdownReport = `
# Executive Leadership Update: ${sTitle} (${qTitle})
*Report Generated on ${new Date().toLocaleDateString()} by Skylark BI Agent*

---

## 1. Executive Summary
This report summarizes the sales pipeline health, project execution performance, and financial status for **${sTitle}** ${quarter ? `during ${quarter}` : 'across all active quarters'}.

* **Total Sales Won:** ₹${totalWonVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (Masked value)
* **Active Pipeline:** ₹${totalOpenVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (Weighted: ₹${weightedOpenVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })})
* **Work Order Billing Value:** ₹${woBilledVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (Out of ₹${woTotalVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })} total contract value)
* **Collected Cash:** ₹${woCollectedVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (Including GST)
* **Outstanding Accounts Receivable (AR):** ₹${woReceivables.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **Work Order Completion Rate:** ${filteredWOs.length > 0 ? ((completedWOsCount / filteredWOs.length) * 100).toFixed(1) : 0}% (${completedWOsCount} completed of ${filteredWOs.length} total work orders)

---

## 2. Sales Pipeline Health
The current pipeline status indicates the following breakdown of potential business:
* **High Probability pipeline:** ₹${filteredDeals.filter(d => d.status.toLowerCase() === 'open' && d.probValue >= 0.8).reduce((sum, d) => sum + d.val, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **Medium Probability pipeline:** ₹${filteredDeals.filter(d => d.status.toLowerCase() === 'open' && d.probValue >= 0.4 && d.probValue < 0.8).reduce((sum, d) => sum + d.val, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **Low Probability pipeline:** ₹${filteredDeals.filter(d => d.status.toLowerCase() === 'open' && d.probValue < 0.4).reduce((sum, d) => sum + d.val, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}

### Key Stages Breakdown:
${Object.entries(
  filteredDeals.reduce((acc, d) => {
    if (d.status.toLowerCase() === 'open') {
      acc[d.stage] = (acc[d.stage] || 0) + d.val;
    }
    return acc;
  }, {})
).map(([stage, val]) => `* **${stage}:** ₹${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`).join('\n')}

---

## 3. Financial Performance & Cashflow Status
Project billing and collections are tracking as follows:
* **Contract Value Executing:** ₹${woTotalVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **Value Billed:** ₹${woBilledVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${((woBilledVal / (woTotalVal || 1)) * 100).toFixed(1)}% billing percentage)
* **Collection Efficiency:** ${woBilledVal > 0 ? ((woCollectedVal / 1.18 / woBilledVal) * 100).toFixed(1) : 0}% of billed value collected (excl. GST)
* **Total Outstanding AR:** ₹${woReceivables.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
  * *AR Priority/Large Accounts (₹10L+ or flagged High):* ₹${filteredWOs.filter(w => w.receivables >= 1000000 || String(w.arPriority).toLowerCase().includes('high')).reduce((sum, w) => sum + w.receivables, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}

---

## 4. Data Quality & Integrity Caveats
The source boards contain inconsistent formatting and missing values that leadership should note:
* **Overall Board Health Score:** ${quality.score}/100
* **Deals Data Caveats:**
  * ${quality.deals.missingValue} deals are missing financial values (defaults to ₹0 in pipeline).
  * ${quality.deals.missingDate} deals are missing close dates (using tentative close dates or defaults).
* **Work Order Data Caveats:**
  * ${quality.workOrders.missingAmount} work orders are missing base amounts.
  * ${quality.workOrders.unlinkedDeals} work orders have deal names that cannot be cross-referenced with the Deals pipeline.

---

## 5. Strategic Recommendations
1. **Accelerate AR Collection:** Prioritize collection efforts on the high-value/flagged AR accounts totaling ₹${filteredWOs.filter(w => w.receivables >= 1000000 || String(w.arPriority).toLowerCase().includes('high')).reduce((sum, w) => sum + w.receivables, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} to boost liquidity.
2. **Review Project execution gaps:** Address the ${filteredWOs.length - completedWOsCount} ongoing or delayed work orders to unlock the remaining unbilled value of ₹${(woTotalVal - woBilledVal).toLocaleString('en-IN', { maximumFractionDigits: 0 })}.
3. **Data Discipline:** Introduce validation rules on the Monday.com boards to prevent records from being saved without key fields (Sectors, Deal Value, and Close Dates).
`;

    return {
      quarter,
      sector,
      totalWonVal,
      totalOpenVal,
      weightedOpenVal,
      woTotalVal,
      woBilledVal,
      woCollectedVal,
      woReceivables,
      completedWOsCount,
      totalWOsCount: filteredWOs.length,
      markdownReport,
      sectorStats,
      qualityScore: quality.score
    };
  }

  // Smart Query Interpreter (Fallback Engine when LLM is unavailable or lacks API Key)
  answerNaturalQuery(queryStr, dealsInput, woInput) {
    const q = String(queryStr).toLowerCase().trim();
    const deals = dealsInput || this.localDeals;
    const wos = woInput || this.localWOs;
    
    // Check for common patterns
    
    // 0. Specific Open / Total Pipeline Query
    if (q.includes('open pipeline') || q.includes('active pipeline') || q.includes('total pipeline') || (q.includes('pipeline') && (q.includes('val') || q.includes('total') || q.includes('open')))) {
      const openDeals = deals.filter(d => d.status.toLowerCase() === 'open');
      const pipeVal = openDeals.reduce((sum, d) => sum + d.val, 0);
      const weightedVal = openDeals.reduce((sum, d) => sum + d.val * d.probValue, 0);
      
      const bySector = {};
      openDeals.forEach(d => {
        const sec = d.sector || 'Others';
        bySector[sec] = (bySector[sec] || 0) + d.val;
      });

      return {
        answer: `### Open Sales Pipeline Analysis
Here is the detailed breakdown of our current **Active Sales Pipeline**:

* **Total Open Deals:** ${openDeals.length}
* **Total Active Pipeline Value:** ₹${pipeVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **Weighted Pipeline Value:** ₹${weightedVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (adjusted for deal probability)
* **Average Open Deal Size:** ₹${openDeals.length > 0 ? Math.round(pipeVal / openDeals.length).toLocaleString('en-IN') : 0}

**Active Pipeline Breakdown by Sector:**
${Object.entries(bySector).map(([sec, val]) => `* **${sec}:** ₹${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${openDeals.filter(d => (d.sector || 'Others') === sec).length} deals)`).join('\n')}`,
        data: {
          labels: Object.keys(bySector),
          datasets: [{
            label: 'Open Pipeline Value (INR)',
            data: Object.values(bySector),
            backgroundColor: ['#22d3ee', '#3b82f6', '#10b981', '#fbbf24', '#a855f7', '#ef4444', '#6b7280']
          }]
        },
        chartType: 'bar'
      };
    }

    // 0.5 Closed Won Deals Query
    if (q.includes('won') || q.includes('closed won') || q.includes('closed deal')) {
      const wonDeals = deals.filter(d => d.status.toLowerCase() === 'won' || d.stage.toLowerCase().includes('won'));
      const wonVal = wonDeals.reduce((sum, d) => sum + d.val, 0);
      
      const bySector = {};
      wonDeals.forEach(d => {
        const sec = d.sector || 'Others';
        bySector[sec] = (bySector[sec] || 0) + d.val;
      });

      return {
        answer: `### Closed Won Deals Summary
Here is the performance summary of our **Closed Won Deals**:

* **Total Won Deals Count:** ${wonDeals.length}
* **Total Closed Won Value:** ₹${wonVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **Average Won Deal Value:** ₹${wonDeals.length > 0 ? Math.round(wonVal / wonDeals.length).toLocaleString('en-IN') : 0}

**Closed Won Value by Sector:**
${Object.entries(bySector).map(([sec, val]) => `* **${sec}:** ₹${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${wonDeals.filter(d => (d.sector || 'Others') === sec).length} deals)`).join('\n')}`,
        data: {
          labels: Object.keys(bySector),
          datasets: [{
            label: 'Closed Won Value (INR)',
            data: Object.values(bySector),
            backgroundColor: ['#10b981', '#3b82f6', '#22d3ee', '#fbbf24', '#a855f7']
          }]
        },
        chartType: 'pie'
      };
    }

    // 1. Pipeline for energy sector
    if (q.includes('pipeline') && (q.includes('energy') || q.includes('renewable') || q.includes('powerline'))) {
      // Aggregate energy sectors (Renewables + Powerline)
      const energyDeals = deals.filter(d => d.sector === 'Renewables' || d.sector === 'Powerline');
      const openEnergy = energyDeals.filter(d => d.status.toLowerCase() === 'open');
      const wonEnergy = energyDeals.filter(d => d.status.toLowerCase() === 'won');
      
      const totalPipelineVal = openEnergy.reduce((sum, d) => sum + d.val, 0);
      const weightedVal = openEnergy.reduce((sum, d) => sum + d.val * d.probValue, 0);
      const wonVal = wonEnergy.reduce((sum, d) => sum + d.val, 0);
      
      let qStr = "this quarter";
      let filterQ = null;
      if (q.includes('q1')) filterQ = 'Q1';
      else if (q.includes('q2')) filterQ = 'Q2';
      else if (q.includes('q3')) filterQ = 'Q3';
      else if (q.includes('q4')) filterQ = 'Q4';
      
      let termPipeline = openEnergy;
      if (filterQ) {
        termPipeline = openEnergy.filter(d => d.quarter === filterQ);
        qStr = `for ${filterQ}`;
      }
      
      const qVal = termPipeline.reduce((sum, d) => sum + d.val, 0);
      const qWeightVal = termPipeline.reduce((sum, d) => sum + d.val * d.probValue, 0);
      
      return {
        answer: `### Energy Sector Pipeline Analysis (${qStr.toUpperCase()})
Here is how the sales pipeline is looking for the **Energy Sector** (comprising **Renewables** and **Powerline**):

* **Total Active Pipeline Value:** ₹${qVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **Weighted Pipeline Value:** ₹${qWeightVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (based on probability)
* **Won Deal Value:** ₹${wonVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **Total Energy Sector Deals:** ${energyDeals.length} (${openEnergy.length} open, ${wonEnergy.length} won)

**Pipeline Breakdown by Sub-Sector:**
* **Renewables:** ₹${termPipeline.filter(d => d.sector === 'Renewables').reduce((sum, d) => sum + d.val, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${termPipeline.filter(d => d.sector === 'Renewables').length} deals)
* **Powerline:** ₹${termPipeline.filter(d => d.sector === 'Powerline').reduce((sum, d) => sum + d.val, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${termPipeline.filter(d => d.sector === 'Powerline').length} deals)

*Caveat:* Out of ${energyDeals.length} records, ${energyDeals.filter(d => !d.val).length} records are missing deal values, which could skew calculations.`,
        data: {
          labels: ['Renewables', 'Powerline'],
          datasets: [{
            label: 'Pipeline Value',
            data: [
              termPipeline.filter(d => d.sector === 'Renewables').reduce((sum, d) => sum + d.val, 0),
              termPipeline.filter(d => d.sector === 'Powerline').reduce((sum, d) => sum + d.val, 0)
            ],
            backgroundColor: ['#22d3ee', '#3b82f6']
          }]
        },
        chartType: 'pie'
      };
    }
    
    // 2. Receivables / AR
    if (q.includes('receivable') || /\bar\b/.test(q) || q.includes('billed') || q.includes('outstanding')) {
      const revenue = this.getRevenueMetrics(woInput);
      
      return {
        answer: `### Accounts Receivable (AR) & Collections Status
Based on the current Work Order Tracker, here is the billing and outstanding receivables summary:

* **Total Executed Contract Value (excl. GST):** ₹${revenue.totalWOAmountExcl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **Total Billed Value (excl. GST):** ₹${revenue.totalBilledValueExcl.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${((revenue.totalBilledValueExcl / revenue.totalWOAmountExcl) * 100).toFixed(1)}% of total contract value billed)
* **Total Outstanding AR:** ₹${revenue.totalReceivables.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **High Priority AR Accounts (₹10L+ or high priority flagged):** ₹${revenue.highPriorityReceivables.toLocaleString('en-IN', { maximumFractionDigits: 0 })}

**Outstanding Receivables by Sector:**
${Object.entries(revenue.bySector).map(([sec, stats]) => `* **${sec}:** ₹${stats.receivables.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (Billed: ₹${stats.billedExcl.toLocaleString('en-IN', { maximumFractionDigits: 0 })})`).join('\n')}

We recommend prioritizing follow-ups on the **High Priority AR Accounts** which comprise ₹${revenue.highPriorityReceivables.toLocaleString('en-IN', { maximumFractionDigits: 0 })} of our outstanding receivables.`,
        data: {
          labels: Object.keys(revenue.bySector),
          datasets: [{
            label: 'Outstanding AR',
            data: Object.values(revenue.bySector).map(s => s.receivables),
            backgroundColor: '#ef4444'
          }]
        },
        chartType: 'bar'
      };
    }
    
    // 3. Mining Sector
    if (q.includes('mining')) {
      const perf = this.getSectoralPerformance(dealsInput, woInput).find(s => s.sector === 'Mining');
      if (!perf) return { answer: 'Mining sector data could not be parsed.' };
      
      return {
        answer: `### Mining Sector Performance Overview
Here is a comprehensive summary of our performance in the **Mining Sector**:

* **Total Pipeline Deals:** ${perf.dealsCount} (Won: ${perf.wonCount})
* **Closed Won Revenue:** ₹${perf.wonValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **Active Pipeline:** ₹${perf.pipelineValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (Weighted: ₹${perf.weightedPipeline.toLocaleString('en-IN', { maximumFractionDigits: 0 })})
* **Work Orders Executed:** ${perf.workOrdersCount} (Completed: ${perf.completedWOs})
* **Revenue Billed (excl GST):** ₹${perf.revenueBilled.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **Cash Collected:** ₹${(perf.revenueCollected * 1.18).toLocaleString('en-IN', { maximumFractionDigits: 0 })} (Incl. GST)
* **Outstanding Receivables (AR):** ₹${perf.receivables.toLocaleString('en-IN', { maximumFractionDigits: 0 })}

*Insights:* Mining represents one of our largest operational areas. However, there are still ${perf.workOrdersCount - perf.completedWOs} ongoing/uncompleted work orders, and outstanding AR stands at ₹${perf.receivables.toLocaleString('en-IN', { maximumFractionDigits: 0 })}.`,
        data: {
          labels: ['Closed Won', 'Active Pipeline', 'Outstanding AR'],
          datasets: [{
            label: 'Value (INR)',
            data: [perf.wonValue, perf.pipelineValue, perf.receivables],
            backgroundColor: ['#10b981', '#fbbf24', '#f87171']
          }]
        },
        chartType: 'bar'
      };
    }
    
    // 3.5 Largest pipeline / pipeline by sector
    if (q.includes('largest pipeline') || (q.includes('sector') && q.includes('pipeline'))) {
      const perf = this.getSectoralPerformance(dealsInput, woInput);
      const sorted = perf.sort((a, b) => b.pipelineValue - a.pipelineValue);
      const top = sorted[0];
      
      return {
        answer: `### Pipeline by Sector Analysis
The sector with the largest active pipeline is **${top.sector}**, with an active pipeline of **₹${top.pipelineValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}**.

Here is the breakdown of the top 5 sectors by pipeline value:
${sorted.slice(0, 5).map(s => `* **${s.sector}:** ₹${s.pipelineValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${s.dealsCount} deals)`).join('\n')}`,
        data: {
          labels: sorted.slice(0, 5).map(s => s.sector),
          datasets: [{
            label: 'Active Pipeline Value',
            data: sorted.slice(0, 5).map(s => s.pipelineValue),
            backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899']
          }]
        },
        chartType: 'bar'
      };
    }
    // 4. Default overall summary
    const totalDeals = deals.length;
    const wonVal = deals.filter(d => d.status.toLowerCase() === 'won').reduce((sum, d) => sum + d.val, 0);
    const pipeVal = deals.filter(d => d.status.toLowerCase() === 'open').reduce((sum, d) => sum + d.val, 0);
    const arTotal = wos.reduce((sum, w) => sum + w.receivables, 0);
    
    return {
      answer: `### Business Intelligence Overview
Welcome to the Skylark Drones BI Agent. Here is a quick snapshot of the business:

* **Total Deals in Pipeline:** ${totalDeals}
* **Total Closed Won Deal Value:** ₹${wonVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **Total Active Pipeline Value:** ₹${pipeVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **Total Outstanding Accounts Receivable (AR):** ₹${arTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
* **Active Work Orders:** ${wos.length} (${wos.filter(w => w.status.toLowerCase() === 'completed').length} completed)

Try asking specific questions like:
1. *"How's our pipeline looking for energy sector this quarter?"*
2. *"What is our outstanding accounts receivable?"*
3. *"Give me an overview of the Mining sector performance."*
4. *"Create a leadership update report."*`,
      data: {
        labels: ['Closed Won', 'Open Pipeline', 'Outstanding AR'],
        datasets: [{
          label: 'Value (INR)',
          data: [wonVal, pipeVal, arTotal],
          backgroundColor: ['#10b981', '#3b82f6', '#ef4444']
        }]
      },
      chartType: 'bar'
    };
  }
}

export {
  BIEngine,
  parseExcelDate,
  parseExcelNumber,
  normalizeSector
};
