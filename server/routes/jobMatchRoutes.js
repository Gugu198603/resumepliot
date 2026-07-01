import { Router } from 'express';
import { matchJobDescription } from '../agents/jdMatcher.js';
import { buildCandidateProfile } from '../services/candidateProfile.js';
import {
  getJobDescription,
  getResume,
  saveJobDescription,
  saveJobMatch
} from '../services/database.js';
import { splitSections } from '../services/resumeParser.js';

const router = Router();

router.post('/jd-match', async (req, res) => {
  try {
    const {
      resumeId = null,
      jdText = '',
      text = '',
      jobId = null,
      title = null,
      company = null,
      sourceUrl = null
    } = req.body || {};
    let jdContent = jdText;
    let job = null;
    if (jobId) {
      job = await getJobDescription(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      jdContent = job.text || '';
    }
    if (!jdContent.trim()) return res.status(400).json({ error: 'jdText or jobId is required' });
    const persistedResume = resumeId ? await getResume(resumeId) : null;
    const resumeText = persistedResume?.text || text || '';
    const resumeChunks = persistedResume?.chunks || [];
    if (!resumeText.trim() && !resumeChunks.length) {
      return res.status(400).json({ error: 'No resume content. Provide resumeId or text.' });
    }
    if (!job) {
      job = await saveJobDescription({ title, company, sourceUrl, source: 'manual', text: jdContent });
    }
    const candidateProfile = buildCandidateProfile(
      persistedResume || { text: resumeText, sections: splitSections(resumeText) }
    );
    const result = await matchJobDescription({
      resumeText,
      resumeChunks,
      jdText: jdContent,
      candidateProfile
    });
    const match = await saveJobMatch({
      jobId: job.id,
      resumeId: persistedResume?.id || resumeId || null,
      matchScore: result.matchScore,
      result
    });
    return res.json({
      resumeId: persistedResume?.id || resumeId || null,
      jobId: job.id,
      matchId: match.id,
      candidateProfile,
      ...result
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export const jobMatchRouter = router;
