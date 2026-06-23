import { loadSkills } from '../services/skillLoader.js';

function keywordScore(goal, skill) {
  const text = `${skill.name} ${skill.description} ${skill.content}`.toLowerCase();
  const words = (goal || '').toLowerCase().split(/\s+|，|。|、|,|\./).filter(Boolean);
  let score = 0;
  for (const word of words) {
    if (text.includes(word)) score += 1;
  }
  return score;
}

export async function routeSkill({ goal }) {
  const skills = await loadSkills();
  const ranked = skills
    .map((skill) => ({ ...skill, score: keywordScore(goal, skill) }))
    .sort((a, b) => b.score - a.score);

  const selected = ranked[0] || null;
  return {
    selectedSkill: selected ? { id: selected.id, name: selected.name, description: selected.description } : null,
    rawContent: selected?.content || '',
    candidates: ranked.slice(0, 3).map((item) => ({ id: item.id, name: item.name, score: item.score })),
    reason: selected ? '根据用户目标和 skill 描述进行关键词匹配，选择最相关 skill。' : '未匹配到 skill。'
  };
}
