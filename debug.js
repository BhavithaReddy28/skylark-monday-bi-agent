const { BIEngine } = require('./src/bi-engine.js');
const engine = new BIEngine();
console.log("Deals length:", engine.localDeals.length);
const quality = engine.getDataQualityReport(engine.localDeals, engine.localWorkOrders);
console.log("Quality Score:", quality.score);
const pipeline = engine.getPipelineHealth(engine.localDeals);
console.log("Pipeline Open Deals Count:", pipeline.openDealsCount);
