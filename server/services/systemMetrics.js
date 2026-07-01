import { provider as vectorProvider } from './vectorStore.js';

export async function getQdrantReadiness() {
  const readiness = {
    provider: vectorProvider,
    configured: vectorProvider === 'qdrant',
    env: {
      QDRANT_URL: process.env.QDRANT_URL || null,
      QDRANT_COLLECTION: process.env.QDRANT_COLLECTION || 'resume_chunks',
      QDRANT_VECTOR_SIZE: process.env.QDRANT_VECTOR_SIZE || '1024',
      QDRANT_API_KEY: process.env.QDRANT_API_KEY ? 'configured' : 'not_set'
    },
    serviceReachable: false,
    collectionReachable: false,
    notes: []
  };
  if (vectorProvider !== 'qdrant') {
    readiness.notes.push('当前 provider 不是 qdrant，所以实际检索不会走向量数据库。');
    return readiness;
  }
  if (!process.env.QDRANT_URL) {
    readiness.notes.push('未设置 QDRANT_URL。');
    return readiness;
  }
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {})
    };
    const root = await fetch(`${process.env.QDRANT_URL}/collections`, { headers });
    readiness.serviceReachable = root.ok;
    if (!root.ok) readiness.notes.push(`Qdrant service responded with status ${root.status}.`);
    const collectionName = process.env.QDRANT_COLLECTION || 'resume_chunks';
    const collection = await fetch(`${process.env.QDRANT_URL}/collections/${collectionName}`, { headers });
    readiness.collectionReachable = collection.ok;
    if (!collection.ok) readiness.notes.push(`Collection ${collectionName} is not reachable yet.`);
  } catch (error) {
    readiness.notes.push(`Qdrant connectivity failed: ${error.message}`);
  }
  if (readiness.serviceReachable && readiness.collectionReachable) {
    readiness.notes.push('Qdrant service and collection are both reachable.');
  }
  return readiness;
}

export function computeDashboard(db) {
  const resumes = db.resumes || [];
  const runs = db.runs || [];
  const sessions = db.sessions || [];
  const corrections = db.corrections || [];
  const turns = sessions.flatMap((session) => session.turns || []);
  const retrievalItems = turns.flatMap((turn) => turn.retrieved || []);
  const retrievedScores = retrievalItems.map((item) => Number(item.score || 0));
  const correctionResumeIds = new Set(corrections.map((item) => item.resumeId).filter(Boolean));
  const errorCounts = new Map();
  let changedSectionTitles = 0;
  let beforeSectionTotal = 0;
  let lineDeltaTotal = 0;
  for (const event of corrections) {
    const summary = event.summary || {};
    changedSectionTitles += Number(summary.changedSectionTitles || 0);
    beforeSectionTotal += Number(summary.beforeSectionCount || 0);
    lineDeltaTotal += Number(summary.lineDelta || 0);
    for (const type of event.errorTypes || summary.errorTypes || []) {
      errorCounts.set(type, (errorCounts.get(type) || 0) + 1);
    }
  }
  const sourceCount = (source) => retrievalItems.filter((item) => item.source === source).length;
  const retrievalCount = Math.max(1, retrievalItems.length);
  return {
    overview: {
      resumes: resumes.length,
      runs: runs.length,
      sessions: sessions.length,
      totalTurns: turns.length,
      vectorProvider
    },
    quality: {
      avgRetrievalScore: Number((
        retrievedScores.reduce((sum, score) => sum + score, 0) / Math.max(1, retrievedScores.length)
      ).toFixed(3)),
      avgSessionDepth: Number((turns.length / Math.max(1, sessions.length)).toFixed(2)),
      skillRoutedRuns: runs.filter((run) => run.skill?.name || run.skillId).length,
      riskCoverage: Number((
        resumes.filter((resume) => (resume.risks || []).length > 0).length / Math.max(1, resumes.length)
      ).toFixed(2)),
      avgCritiqueLength: Number((
        turns.reduce((sum, turn) => sum + (
          Array.isArray(turn.critique)
            ? turn.critique.join(' ').length
            : String(turn.critique || '').length
        ), 0) / Math.max(1, turns.length)
      ).toFixed(1)),
      improvedAnswerCoverage: Number((
        turns.filter((turn) => String(turn.improvedAnswer || '').trim()).length / Math.max(1, turns.length)
      ).toFixed(2))
    },
    correctionMetrics: {
      totalCorrections: corrections.length,
      correctedResumes: correctionResumeIds.size,
      correctionRate: Number((correctionResumeIds.size / Math.max(1, resumes.length)).toFixed(2)),
      sectionChangeRatio: Number((changedSectionTitles / Math.max(1, beforeSectionTotal)).toFixed(2)),
      avgLineDelta: Number((lineDeltaTotal / Math.max(1, corrections.length)).toFixed(1)),
      commonErrorTypes: [...errorCounts.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6)
    },
    sourceMix: {
      resume: Number((sourceCount('resume') / retrievalCount).toFixed(2)),
      session_history: Number((sourceCount('session_history') / retrievalCount).toFixed(2))
    },
    trend: sessions.map((session) => ({
      title: session.title,
      turns: session.turns?.length || 0,
      createdAt: session.createdAt
    })),
    retrievalSamples: sessions
      .flatMap((session) => (session.turns || []).slice(-2).map((turn) => ({
        session: session.title,
        question: turn.question,
        retrieved: turn.retrieved || []
      })))
      .slice(-6),
    evalNotes: [
      'avgRetrievalScore 反映当前上下文召回相关性。',
      'avgSessionDepth 反映用户是否形成持续训练行为。',
      'sourceMix 反映系统是更多依赖简历还是历史对话。',
      'improvedAnswerCoverage 反映改写模块在多轮会话中的参与程度。'
    ]
  };
}
