export const SYSTEM_TERMS = [
  'SSR', 'CRDT', 'RAG', '向量数据库', 'agent', '埋点', '性能优化', '兼容性', 'SDK', 'postMessage',
  '缓存', '虚拟列表', '多端适配', '监控', '渲染', 'WebWorker', 'IndexedDB', 'Tailwind', 'TypeScript'
];

export function normalizeText(text = '') {
  return text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

export function splitSections(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const sections = [];
  let current = { title: '未分类', content: [] };

  for (const line of lines) {
    if (/^(教育背景|核心技能|技能栈|实习经历|工作经验|项目经历|荣誉奖项|奖项|自我评价|Education|Skills|Experience|Projects|Awards|Summary)/i.test(line)) {
      if (current.content.length) sections.push(current);
      current = { title: line, content: [] };
    } else {
      current.content.push(line);
    }
  }
  if (current.content.length) sections.push(current);
  return sections;
}

export function detectRisks(text) {
  const found = SYSTEM_TERMS.filter((term) => text.toLowerCase().includes(term.toLowerCase()));
  return found.map((term) => ({
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
