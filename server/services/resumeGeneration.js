import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const skillSrcDir = path.join(rootDir, 'skills/resume-generation-skill/src');

function normalizeLine(line = '') {
  return String(line || '').replace(/\s+/g, ' ').trim();
}

function sectionText(section) {
  return [section?.title, ...(section?.content || [])].map(normalizeLine).filter(Boolean).join('\n');
}

function includesAny(title = '', words = []) {
  return words.some((word) => title.toLowerCase().includes(word.toLowerCase()));
}

function findSection(sections = [], words = []) {
  return sections.find((section) => includesAny(section.title || '', words)) || null;
}

function splitMetaLine(line = '') {
  const text = normalizeLine(line);
  const email = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] || '';
  const phone = text.match(/(?:\+?\d[\d -]{7,}\d)/)?.[0] || '';
  return { email, phone };
}

function dateRangeOf(line = '') {
  const text = normalizeLine(line);
  const match = text.match(/((?:19|20)\d{2}[./-]\d{1,2})(?:\s*(?:-|至|~|—|–)\s*((?:19|20)\d{2}[./-]\d{1,2}|至今|现在))?/);
  return match ? { startDate: match[1] || '', endDate: match[2] || '', raw: match[0] } : null;
}

function looksLikeExperienceHeading(line = '') {
  const text = normalizeLine(line);
  return Boolean(dateRangeOf(text)) && /公司|大学|学院|实验室|团队|部门|中心|工作室|项目|实习|工程师|开发|负责人/.test(text);
}

function splitTitledEntries(lines = []) {
  const entries = [];
  let current = null;
  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) continue;
    if (!current || looksLikeExperienceHeading(line)) {
      current = { title: line, lines: [] };
      entries.push(current);
    } else {
      current.lines.push(line);
    }
  }
  return entries;
}

function parseRoleAndOrg(title = '') {
  const date = dateRangeOf(title);
  const withoutDate = normalizeLine(date ? title.replace(date.raw, '') : title);
  const roleOrg = withoutDate.match(/^(.{2,18}(?:实习生|工程师|开发|设计|运营|负责人|成员|经理|专员|助理|研究员|顾问))(.{2,})$/);
  if (roleOrg) {
    return {
      position: normalizeLine(roleOrg[1]),
      name: normalizeLine(roleOrg[2]),
      startDate: date?.startDate || '',
      endDate: date?.endDate || ''
    };
  }
  return {
    position: '',
    name: withoutDate,
    startDate: date?.startDate || '',
    endDate: date?.endDate || ''
  };
}

function buildBasics(resume, sections, adjustment) {
  const basicSection = findSection(sections, ['基本', '个人', '联系', 'contact', 'profile']) || sections[0] || null;
  const lines = basicSection?.content || [];
  const merged = lines.join(' ');
  const { email, phone } = splitMetaLine(merged);
  const name = normalizeLine(lines[0] || '').split(/[，,|｜\s]/).filter(Boolean)[0] || '';
  const targetRole = adjustment.match(/(?:目标岗位|岗位|职位)[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9 +#.-]{2,30})/)?.[1]?.trim() || '';
  return {
    name,
    label: targetRole,
    email,
    phone,
    summary: normalizeLine(lines.slice(1, 4).join(' ')),
    source_ids: ['resume-original', ...(adjustment.trim() ? ['conversation-adjustment'] : [])]
  };
}

function buildSkills(sections = []) {
  const skillSections = sections.filter((section) => includesAny(section.title || '', ['技能', 'skills', '技术']));
  return skillSections.map((section) => ({
    name: section.title,
    keywords: (section.content || [])
      .flatMap((line) => normalizeLine(line).split(/[、,，;；/|｜\s]+/))
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
      .slice(0, 30),
    source_ids: ['resume-original']
  })).filter((item) => item.keywords.length);
}

function buildWork(sections = []) {
  const workSections = sections.filter((section) => includesAny(section.title || '', ['工作', '实习', 'experience']));
  return workSections.flatMap((section) => splitTitledEntries(section.content || []).map((entry) => {
    const parsed = parseRoleAndOrg(entry.title);
    return {
      name: parsed.name || normalizeLine(section.title),
      position: parsed.position || section.title,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      summary: normalizeLine(entry.lines[0] || ''),
      highlights: entry.lines.map((line) => ({ text: normalizeLine(line), source_ids: ['resume-original'] })).filter((item) => item.text),
      source_ids: ['resume-original']
    };
  }));
}

function buildProjects(sections = []) {
  const projectSections = sections.filter((section) => includesAny(section.title || '', ['项目', 'projects']));
  return projectSections.flatMap((section) => splitTitledEntries(section.content || []).map((entry) => {
    const parsed = parseRoleAndOrg(entry.title);
    return {
      name: parsed.name || normalizeLine(entry.title || section.title),
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      description: normalizeLine(entry.lines[0] || ''),
      highlights: entry.lines.map((line) => ({ text: normalizeLine(line), source_ids: ['resume-original'] })).filter((item) => item.text),
      source_ids: ['resume-original']
    };
  }));
}

function buildEducation(sections = []) {
  const educationSections = sections.filter((section) => includesAny(section.title || '', ['教育', 'education']));
  return educationSections.map((section) => {
    const text = sectionText(section);
    const dates = text.match(/\b(?:19|20)\d{2}[./-]\d{1,2}\b/g) || [];
    return {
      institution: normalizeLine((section.content || [])[0] || section.title),
      area: normalizeLine((section.content || [])[1] || ''),
      startDate: dates[0] || '',
      endDate: dates[1] || '',
      source_ids: ['resume-original']
    };
  });
}

export function buildCareerProfileFromResume({ resume, adjustment = '' }) {
  const sections = Array.isArray(resume?.sections) ? resume.sections : [];
  const evidence = [
    {
      id: 'resume-original',
      kind: 'original_resume',
      text: resume?.text || sections.map(sectionText).join('\n')
    }
  ];
  if (adjustment.trim()) {
    evidence.push({
      id: 'conversation-adjustment',
      kind: 'conversation_confirmation',
      confirmed: true,
      text: adjustment.trim()
    });
  }

  return {
    evidence,
    basics: buildBasics(resume, sections, adjustment),
    work: buildWork(sections),
    projects: buildProjects(sections),
    education: buildEducation(sections),
    skills: buildSkills(sections),
    metadata: {
      targetRole: adjustment.match(/(?:目标岗位|岗位|职位)[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9 +#.-]{2,30})/)?.[1]?.trim() || ''
    }
  };
}

export async function generateResumePreview({ resume, adjustment = '', jobDescription = '' }) {
  const careerProfile = buildCareerProfileFromResume({ resume, adjustment });
  const payload = JSON.stringify({ careerProfile, jobDescription });

  return await new Promise((resolve, reject) => {
    const child = spawn('python3', ['-m', 'resume_generation_skill.cli'], {
      cwd: rootDir,
      env: { ...process.env, PYTHONPATH: skillSrcDir },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', () => {
      try {
        const parsed = JSON.parse(stdout || stderr || '{}');
        resolve({ ...parsed, careerProfile });
      } catch (error) {
        reject(new Error(`Failed to parse resume generation output: ${error.message}; stderr=${stderr}`));
      }
    });
    child.stdin.end(payload);
  });
}
