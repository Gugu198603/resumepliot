export function parseSkillWorkflow(skillContent = '') {
  const lines = skillContent.split('\n');
  const steps = [];
  let inWorkflow = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^##\s+Workflow/i.test(line)) {
      inWorkflow = true;
      continue;
    }
    if (inWorkflow && /^##\s+/.test(line)) break;
    if (!inWorkflow) continue;

    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      steps.push(numbered[1]);
    }
  }

  return steps.map((text, index) => {
    const lower = text.toLowerCase();
    let agent = 'planner';
    if (/parse|normalize|extract|detect/.test(lower)) agent = 'parser';
    if (/planner|decide/.test(lower)) agent = 'planner';
    if (/retriev|chunk|knowledge base/.test(lower)) agent = 'retriever';
    if (/generate|question|ask/.test(lower)) agent = 'interviewer';
    if (/critique|evaluate/.test(lower)) agent = 'critic';
    if (/rewrite|improve/.test(lower)) agent = 'writer';
    return { order: index + 1, text, agent };
  });
}

export function resolveExecutionPlan(skill) {
  const steps = parseSkillWorkflow(skill?.content || '');
  const normalized = steps.length ? steps : [
    { order: 1, text: 'Parse input text', agent: 'parser' },
    { order: 2, text: 'Plan next action', agent: 'planner' },
    { order: 3, text: 'Retrieve relevant chunks', agent: 'retriever' }
  ];
  return normalized;
}
