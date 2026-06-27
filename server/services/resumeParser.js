const SECTION_HEADING_RE = /^(基本信息|个人信息|联系方式|求职意向|教育背景|校园经历|核心技能|个人技能|专业技能|技能栈|实习经历|工作经验|项目经历|项目经验|实践经历|荣誉奖项|奖项|证书|自我评价|求职简历|Education|Skills|Experience|Projects|Awards|Summary|Contact|Profile)$/i;
const LEADING_BULLET_RE = /^[\s\u2022\u2023\u25e6\u2043\u2219\u25aa\u25ab\u25cf\u25a0\u25a1\u25ae\u25af\u25e7\uF000-\uF8FF•●▪■▮□◦‣⁃·\-–—]+/;
const ENGLISH_STOPWORDS = new Set(['and', 'the', 'for', 'with', 'from', 'this', 'that', 'user', 'users', 'data']);
const DECORATIVE_RESUME_RE = /^(PERSONAL\s*RESUME|PERSONALRESUME|求职简历|我一直在努力[!！]?|我会加油(?:的)?[!！]?|加油[!！]?|继续努力[!！]?)$/i;
const PROJECT_SECTION_RE = /^(项目经历|项目经验|实践经历|Projects)$/i;
const DATE_RANGE_RE = /(?:19|20)\d{2}(?:[./-]\d{1,2})?\s*[-–—]\s*(?:(?:19|20)\d{2}(?:[./-]\d{1,2})?|至今|Present)/i;

function cleanLine(line = '') {
  return String(line)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uF000-\uF8FF\uFFFD]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .replace(LEADING_BULLET_RE, '')
    .trim();
}

function isDecorativeLine(line = '') {
  const text = cleanLine(line);
  if (!text) return true;
  if (DECORATIVE_RESUME_RE.test(text)) return true;
  if (!/[\p{L}\p{N}]/u.test(text)) return true;
  const meaningfulChars = (text.match(/[\p{Script=Han}A-Za-z0-9.+#@-]/gu) || []).length;
  return text.length >= 6 && meaningfulChars / text.length < 0.35;
}

export function normalizeText(text = '') {
  return String(text)
    .replace(/\r/g, '')
    .replace(/\f/g, '\n')
    .replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uF000-\uF8FF\uFFFD]/g, '')
    .split('\n')
    .map(cleanLine)
    .filter((line) => !isDecorativeLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanSectionContent(content = []) {
  return content
    .map(cleanLine)
    .filter((line) => !isDecorativeLine(line));
}

function isProjectStart(line = '') {
  return DATE_RANGE_RE.test(line) && /项目|系统|平台|应用|SDK|画布|协作|看板|Web前端|前端/i.test(line);
}

function repairTrailingSectionHeadings(lines = []) {
  const repaired = [...lines];
  for (let idx = repaired.length - 1; idx > 0; idx -= 1) {
    const heading = repaired[idx];
    if (!PROJECT_SECTION_RE.test(heading)) continue;
    const hasContentAfterHeading = repaired.slice(idx + 1).some((line) => line && !SECTION_HEADING_RE.test(line));
    if (hasContentAfterHeading) continue;

    const projectStart = repaired.findIndex((line, lineIdx) => lineIdx < idx && isProjectStart(line));
    if (projectStart < 0) continue;

    repaired.splice(idx, 1);
    repaired.splice(projectStart, 0, heading);
    break;
  }
  return repaired;
}

function inferSectionTitle(content = [], fallbackTitle = '简历概览') {
  const text = content.join('\n');
  if (/姓名|手机|电话|邮箱|微信|求职意向/.test(text)) return '基本信息';
  if (/(实习生|工程师|公司|字节跳动|有限公司|工作经历|工作经验)/i.test(text) && /工作|实习|职责|开发|重构|修复|负责|参与/.test(text)) return '工作经验';
  if (/技术栈[:：]|^[^\n]{0,24}项目20\d{2}[./-]\d{1,2}|^[^\n]{0,40}项目\s*$/im.test(text)) return '项目经验';
  if (/熟练|掌握|了解|技能|框架|React|Vue|Node|JavaScript|TypeScript|Webpack|Vite|CSS|HTML|MySQL|Git/i.test(text)) return '个人技能';
  if (/大学|学院|本科|硕士|博士|GPA|绩点|专业|20\d{2}[./-]\d{1,2}/i.test(text)) return '教育背景';
  if (fallbackTitle && fallbackTitle !== '未分类' && fallbackTitle !== '求职简历') return fallbackTitle;
  return '简历概览';
}

function pushSection(sections, section) {
  const content = cleanSectionContent(section.content || []);
  if (!content.length) return;
  const title = inferSectionTitle(content, section.title);
  sections.push({ title, content });
}

function splitMixedProjectSections(sections = []) {
  const result = [];
  for (const section of sections) {
    if (!/^(工作经验|实习经历|Experience)$/i.test(section.title)) {
      result.push(section);
      continue;
    }
    const projectStart = section.content.findIndex((line, index) => index > 0 && isProjectStart(line));
    if (projectStart < 0) {
      result.push(section);
      continue;
    }
    result.push({ title: section.title, content: section.content.slice(0, projectStart) });
    result.push({ title: '项目经验', content: section.content.slice(projectStart) });
  }
  return result.filter((section) => section.content.length);
}

export function splitSections(text) {
  const lines = repairTrailingSectionHeadings(text.split('\n').map(cleanLine).filter((line) => !isDecorativeLine(line)));
  const sections = [];
  let current = { title: '未分类', content: [] };

  for (const line of lines) {
    if (SECTION_HEADING_RE.test(line)) {
      if (/^(基本信息|个人信息|联系方式)$/i.test(line) && !current.content.length && sections.some((section) => section.title === '基本信息')) {
        continue;
      }
      pushSection(sections, current);
      current = { title: line, content: [] };
    } else if (/^(工作经验|实习经历|Experience)$/i.test(current.title) && isProjectStart(line)) {
      pushSection(sections, current);
      current = { title: '项目经验', content: [line] };
    } else {
      current.content.push(line);
    }
  }
  pushSection(sections, current);
  return splitMixedProjectSections(sections);
}

function addTerm(terms, seen, raw) {
  const term = String(raw || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.+#-]+$/gu, '').trim();
  if (!term || term.length < 2) return;
  const key = term.toLowerCase();
  if (seen.has(key) || ENGLISH_STOPWORDS.has(key)) return;
  seen.add(key);
  terms.push(term);
}

function extractRiskTerms(text = '') {
  const terms = [];
  const seen = new Set();

  const stackMatches = String(text).matchAll(/技术栈[:：]\s*([^\n]+)/g);
  for (const match of stackMatches) {
    for (const part of match[1].split(/[,+/、，；;\s]+/)) addTerm(terms, seen, part);
  }

  for (const match of String(text).matchAll(/[A-Za-z][A-Za-z0-9.+#-]{1,}/g)) {
    const token = match[0];
    if (/[A-Z0-9.+#-]/.test(token) || token.length >= 4) addTerm(terms, seen, token);
  }

  for (const match of String(text).matchAll(/[\u4e00-\u9fa5A-Za-z0-9.+#-]{0,8}(?:优化|架构|缓存|监控|渲染|兼容性|埋点|协作|检索|向量|虚拟列表|多端适配)[\u4e00-\u9fa5A-Za-z0-9.+#-]{0,8}/g)) {
    addTerm(terms, seen, match[0]);
  }

  return terms.slice(0, 20);
}

export function detectRisks(text) {
  return extractRiskTerms(text).map((term) => ({
    term,
    reason: '该术语容易被追问实现细节，建议准备背景、方案、实现、结果四段式回答。'
  }));
}

export function rewriteResume(text) {
  const sections = splitSections(text);
  const lines = sections.flatMap((section) => {
    const top = section.content.slice(0, Math.min(4, section.content.length));
    return [`【${section.title}】`, ...top];
  });

  return {
    concise: lines.slice(0, 18).join('\n'),
    detailed: sections.map((section) => `【${section.title}】\n${section.content.join('\n')}`).join('\n\n')
  };
}
