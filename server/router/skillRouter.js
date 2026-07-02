import { loadSkills } from '../services/skillLoader.js';
import { classifySkillGoal } from '../services/skillClassifier.js';

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function skillConfidence(goal, skill) {
  const query = normalize(goal);
  if (!query) return 0;
  const triggers = skill.triggers.map(normalize).filter(Boolean);
  if (triggers.some((trigger) => query.includes(trigger))) return 0.95;
  const queryTerms = query.match(/[a-z0-9]+|[\u3400-\u9fff]{2,}/g) || [];
  let best = 0;
  for (const trigger of triggers) {
    const terms = trigger.match(/[a-z0-9]+|[\u3400-\u9fff]{2,}/g) || [];
    const matches = terms.filter((term) => query.includes(term) || term.includes(query)).length;
    if (terms.length) best = Math.max(best, matches / terms.length);
  }
  const descriptionHit = queryTerms.some((term) => normalize(skill.description).includes(term));
  return Math.min(0.85, best * 0.75 + (descriptionHit ? 0.1 : 0));
}

export async function routeSkill({ goal }) {
  const [skills, classifier] = await Promise.all([
    loadSkills(),
    classifySkillGoal(goal)
  ]);
  const modelProbabilities = new Map(
    (classifier.probabilities || []).map((item) => [item.label, item.probability])
  );
  const ranked = skills
    .map((skill) => {
      const ruleConfidence = skillConfidence(goal, skill);
      const modelProbability = modelProbabilities.get(skill.id) || 0;
      const exactRuleMatch = ruleConfidence >= 0.95;
      let confidence = ruleConfidence;
      let routingSource = 'rules';
      if (classifier.available) {
        if (exactRuleMatch) {
          confidence = Math.max(ruleConfidence, modelProbability);
          routingSource = 'exact-rule';
        } else if (!classifier.rejected && classifier.predictedLabel === skill.id) {
          confidence = Math.min(1, 0.7 * modelProbability + 0.3 * ruleConfidence + 0.2);
          routingSource = 'classifier';
        } else {
          confidence = Math.min(1, 0.25 * modelProbability + 0.25 * ruleConfidence);
          routingSource = classifier.rejected ? 'rejected-model' : 'non-winning-model';
        }
      }
      return {
        ...skill,
        confidence,
        ruleConfidence,
        modelProbability,
        routingSource,
        exactRuleMatch
      };
    })
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));

  const best = ranked[0] || null;
  const modelAllowsSelection = !classifier.available ||
    best?.exactRuleMatch ||
    (!classifier.rejected && classifier.predictedLabel === best?.id);
  const selected = best && modelAllowsSelection && best.confidence >= best.routing.minConfidence ? best : null;
  return {
    selectedSkill: selected ? {
      id: selected.id,
      name: selected.name,
      version: selected.version,
      description: selected.description,
      confidence: selected.confidence,
      allowedTools: selected.allowedTools,
      inputSchema: selected.inputSchema,
      outputSchema: selected.outputSchema,
      runtime: selected.runtime,
      routingSource: selected.routingSource
    } : null,
    rawContent: selected?.content || '',
    candidates: ranked.slice(0, 3).map((item) => ({
      id: item.id,
      name: item.name,
      version: item.version,
      confidence: item.confidence,
      ruleConfidence: item.ruleConfidence,
      modelProbability: item.modelProbability,
      routingSource: item.routingSource,
      minConfidence: item.routing.minConfidence,
      accepted: item === selected
    })),
    classifier: {
      available: classifier.available,
      modelId: classifier.modelId,
      modelVersion: classifier.modelVersion,
      datasetVersion: classifier.datasetVersion,
      predictedLabel: classifier.predictedLabel,
      label: classifier.label,
      confidence: classifier.confidence,
      margin: classifier.margin,
      rejected: classifier.rejected,
      rejectionReason: classifier.rejectionReason,
      probabilities: classifier.probabilities
    },
    rejected: !selected,
    reason: selected
      ? `${selected.routingSource} 路由选择 ${selected.id}，融合置信度 ${selected.confidence.toFixed(2)} 达到阈值 ${selected.routing.minConfidence.toFixed(2)}。`
      : classifier.available && classifier.rejected
        ? `分类模型拒绝路由：${classifier.rejectionReason}，预测 ${classifier.predictedLabel}，置信度 ${classifier.confidence.toFixed(2)}。`
        : `最高融合置信度 ${(best?.confidence || 0).toFixed(2)} 未达到阈值 ${(best?.routing?.minConfidence || 0).toFixed(2)}，拒绝猜测 Skill。`
  };
}
