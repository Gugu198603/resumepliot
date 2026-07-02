process.env.VECTOR_STORE_PROVIDER ||= 'memory';

const { evaluateGoldenDataset, loadGoldenDataset } = await import('../server/services/ragEvaluation.js');
const report = await evaluateGoldenDataset({ dataset: await loadGoldenDataset() });

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
