import { createHash } from 'crypto';
import {
  activateKnowledgeBaseVersion,
  createKnowledgeBaseVersion,
  listKnowledgeBaseVersions,
  updateKnowledgeBaseVersion,
  updateResume
} from './database.js';
import { logger } from './logger.js';
import {
  buildKnowledgeBase,
  deleteVectorNamespace,
  provider as vectorProvider
} from './vectorStore.js';

function contentHash(text) {
  return createHash('sha256').update(String(text || '')).digest('hex');
}

export async function rebuildResumeKnowledgeBase({ resumeId, text, sections, risks }) {
  const versions = await listKnowledgeBaseVersions({ resumeId });
  const versionNumber = Math.max(0, ...versions.map((item) => Number(item.versionNumber) || 0)) + 1;
  const hash = contentHash(text);
  const namespace = `resume:${resumeId}:kb:v${versionNumber}:${hash.slice(0, 12)}`;
  const version = await createKnowledgeBaseVersion({
    resumeId,
    versionNumber,
    contentHash: hash,
    namespace,
    vectorProvider,
    status: 'building',
    chunkCount: 0
  });

  try {
    const kb = await buildKnowledgeBase(text, namespace);
    const chunks = kb.map((chunk) => ({
      ...chunk,
      resumeId,
      knowledgeBaseVersionId: version.id,
      knowledgeBaseVersion: versionNumber,
      namespace
    }));
    const resume = await updateResume(resumeId, {
      text,
      sections,
      risks,
      kbSize: chunks.length,
      chunks,
      vectorProvider,
      knowledgeBaseVersionId: version.id,
      knowledgeBaseVersion: versionNumber
    });
    if (!resume) throw new Error(`Resume not found while activating knowledge base: ${resumeId}`);
    await updateKnowledgeBaseVersion(version.id, { chunkCount: chunks.length });
    const activeVersion = await activateKnowledgeBaseVersion(version.id);
    return { resume, version: activeVersion, chunks };
  } catch (error) {
    await updateKnowledgeBaseVersion(version.id, { status: 'failed' }).catch(() => {});
    await deleteVectorNamespace(namespace).catch(() => {});
    throw error;
  }
}

export async function cleanupRetiredKnowledgeBases({
  retentionDays = Number(process.env.KB_RETENTION_DAYS || 7),
  resumeId = null,
  dryRun = false
} = {}) {
  const cutoff = new Date(Date.now() - Math.max(0, retentionDays) * 86_400_000).toISOString();
  const retired = await listKnowledgeBaseVersions({
    resumeId: resumeId || undefined,
    status: 'retired',
    retiredBefore: cutoff
  });
  const results = [];
  for (const version of retired) {
    if (dryRun) {
      results.push({ id: version.id, namespace: version.namespace, status: 'dry-run' });
      continue;
    }
    try {
      await deleteVectorNamespace(version.namespace);
      await updateKnowledgeBaseVersion(version.id, {
        status: 'deleted',
        deletedAt: new Date().toISOString()
      });
      results.push({ id: version.id, namespace: version.namespace, status: 'deleted' });
    } catch (error) {
      logger.error('knowledge_base.cleanup_failed', {
        versionId: version.id,
        namespace: version.namespace,
        error: error.message
      });
      results.push({ id: version.id, namespace: version.namespace, status: 'failed', error: error.message });
    }
  }
  return {
    retentionDays,
    cutoff,
    dryRun,
    candidates: retired.length,
    deleted: results.filter((item) => item.status === 'deleted').length,
    failed: results.filter((item) => item.status === 'failed').length,
    results
  };
}

export async function deleteResumeVectorData(resumeId) {
  const versions = await listKnowledgeBaseVersions({ resumeId });
  const results = await Promise.allSettled(
    versions
      .filter((item) => item.status !== 'deleted')
      .map((item) => deleteVectorNamespace(item.namespace))
  );
  return {
    versions: versions.length,
    deleted: results.filter((item) => item.status === 'fulfilled').length,
    failed: results.filter((item) => item.status === 'rejected').length
  };
}
