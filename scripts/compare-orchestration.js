import { runOrchestrationComparison } from '../server/experiments/orchestrationComparison.js';

const iterations = Number(process.argv[2] || 50);
const report = await runOrchestrationComparison({ iterations });
console.log(JSON.stringify(report, null, 2));
if (!report.outputParity) process.exitCode = 1;
