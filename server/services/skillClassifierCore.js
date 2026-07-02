const UNKNOWN_LABEL = 'unknown';

export function validateSkillRouterDataset(dataset) {
  if (!dataset?.id || !dataset?.version || !Array.isArray(dataset.labels) || !dataset.labels.includes(UNKNOWN_LABEL)) {
    throw new Error('Skill Router dataset requires id, version, labels and the unknown label.');
  }
  const seen = new Map();
  for (const split of ['train', 'validation', 'test']) {
    if (!Array.isArray(dataset[split]) || !dataset[split].length) {
      throw new Error(`Skill Router dataset split ${split} must not be empty.`);
    }
    for (const [index, example] of dataset[split].entries()) {
      if (!String(example?.text || '').trim() || !dataset.labels.includes(example?.label)) {
        throw new Error(`Invalid ${split} example at index ${index}.`);
      }
      const key = String(example.text).toLowerCase().replace(/\s+/g, '');
      if (seen.has(key)) throw new Error(`Dataset leakage: duplicate text in ${seen.get(key)} and ${split}.`);
      seen.set(key, split);
    }
  }
  for (const label of dataset.labels) {
    if (!dataset.train.some((item) => item.label === label)) {
      throw new Error(`Training split has no examples for label ${label}.`);
    }
  }
  return {
    labels: dataset.labels.length,
    train: dataset.train.length,
    validation: dataset.validation.length,
    test: dataset.test.length
  };
}

export function tokenizeSkillText(value = '') {
  const text = String(value).toLowerCase().normalize('NFKC');
  const tokens = [];
  for (const word of text.match(/[a-z0-9+#.]+/g) || []) {
    tokens.push(`w:${word}`);
  }
  for (const segment of text.match(/[\u3400-\u9fff]+/g) || []) {
    if (segment.length === 1) tokens.push(`c:${segment}`);
    for (let index = 0; index < segment.length - 1; index += 1) {
      tokens.push(`c:${segment.slice(index, index + 2)}`);
    }
    for (let index = 0; index < segment.length - 2; index += 1) {
      tokens.push(`c3:${segment.slice(index, index + 3)}`);
    }
  }
  return tokens;
}

export function trainNaiveBayes(examples = [], {
  labels = [...new Set(examples.map((item) => item.label))],
  alpha = 1
} = {}) {
  const documentCounts = Object.fromEntries(labels.map((label) => [label, 0]));
  const tokenCounts = Object.fromEntries(labels.map((label) => [label, {}]));
  const totalTokens = Object.fromEntries(labels.map((label) => [label, 0]));
  const vocabulary = new Set();

  for (const example of examples) {
    if (!labels.includes(example.label)) throw new Error(`Unknown training label: ${example.label}`);
    documentCounts[example.label] += 1;
    for (const token of tokenizeSkillText(example.text)) {
      vocabulary.add(token);
      tokenCounts[example.label][token] = (tokenCounts[example.label][token] || 0) + 1;
      totalTokens[example.label] += 1;
    }
  }

  return {
    type: 'multinomial-naive-bayes',
    alpha,
    labels,
    vocabularySize: vocabulary.size,
    documentCount: examples.length,
    documentCounts,
    totalTokens,
    tokenCounts
  };
}

export function predictNaiveBayes(model, text) {
  const tokens = tokenizeSkillText(text);
  const tokenFrequency = new Map();
  for (const token of tokens) tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1);
  const scores = model.labels.map((label) => {
    const prior = (model.documentCounts[label] + model.alpha) /
      (model.documentCount + model.alpha * model.labels.length);
    let logProbability = Math.log(prior);
    const denominator = model.totalTokens[label] + model.alpha * model.vocabularySize;
    for (const [token, frequency] of tokenFrequency.entries()) {
      if (!Object.values(model.tokenCounts).some((counts) => counts[token])) continue;
      const likelihood = ((model.tokenCounts[label][token] || 0) + model.alpha) / denominator;
      logProbability += frequency * Math.log(likelihood);
    }
    return { label, logProbability };
  });
  const maxLog = Math.max(...scores.map((item) => item.logProbability));
  const normalizer = scores.reduce((sum, item) => sum + Math.exp(item.logProbability - maxLog), 0);
  const probabilities = scores
    .map((item) => ({
      label: item.label,
      probability: Math.exp(item.logProbability - maxLog) / normalizer
    }))
    .sort((a, b) => b.probability - a.probability || a.label.localeCompare(b.label));
  return {
    label: probabilities[0]?.label || UNKNOWN_LABEL,
    confidence: probabilities[0]?.probability || 0,
    margin: (probabilities[0]?.probability || 0) - (probabilities[1]?.probability || 0),
    probabilities
  };
}

export function classifyWithRejection(model, text, thresholds = {}) {
  const prediction = predictNaiveBayes(model, text);
  const minConfidence = Number(thresholds.minConfidence ?? 0.45);
  const minMargin = Number(thresholds.minMargin ?? 0.1);
  const rejected = prediction.label === UNKNOWN_LABEL ||
    prediction.confidence < minConfidence ||
    prediction.margin < minMargin;
  return {
    ...prediction,
    predictedLabel: prediction.label,
    label: rejected ? UNKNOWN_LABEL : prediction.label,
    rejected,
    rejectionReason: prediction.label === UNKNOWN_LABEL
      ? 'model_predicted_unknown'
      : prediction.confidence < minConfidence
        ? 'confidence_below_threshold'
        : prediction.margin < minMargin
          ? 'margin_below_threshold'
          : null
  };
}

export function evaluateSkillClassifier(model, examples = [], thresholds = {}) {
  const labels = model.labels;
  const confusion = Object.fromEntries(labels.map((actual) => [
    actual,
    Object.fromEntries(labels.map((predicted) => [predicted, 0]))
  ]));
  const predictions = examples.map((example) => {
    const result = classifyWithRejection(model, example.text, thresholds);
    confusion[example.label][result.label] += 1;
    return { text: example.text, actualLabel: example.label, ...result };
  });
  const perLabel = labels.map((label) => {
    const tp = confusion[label][label];
    const fp = labels.reduce((sum, actual) => sum + (actual === label ? 0 : confusion[actual][label]), 0);
    const fn = labels.reduce((sum, predicted) => sum + (predicted === label ? 0 : confusion[label][predicted]), 0);
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
    return { label, precision, recall, f1, support: tp + fn };
  });
  return {
    total: examples.length,
    accuracy: examples.length
      ? Number((predictions.filter((item) => item.label === item.actualLabel).length / examples.length).toFixed(3))
      : 0,
    macroF1: Number((perLabel.reduce((sum, item) => sum + item.f1, 0) / labels.length).toFixed(3)),
    unknownRecall: Number((perLabel.find((item) => item.label === UNKNOWN_LABEL)?.recall || 0).toFixed(3)),
    coverage: examples.length
      ? Number((predictions.filter((item) => !item.rejected).length / examples.length).toFixed(3))
      : 0,
    confusion,
    perLabel: perLabel.map((item) => ({
      ...item,
      precision: Number(item.precision.toFixed(3)),
      recall: Number(item.recall.toFixed(3)),
      f1: Number(item.f1.toFixed(3))
    })),
    predictions
  };
}

export function calibrateClassifier(model, validation = []) {
  let best = null;
  for (const minConfidence of [0.35, 0.4, 0.5, 0.6, 0.7]) {
    for (const minMargin of [0.05, 0.1, 0.2, 0.3]) {
      const metrics = evaluateSkillClassifier(model, validation, { minConfidence, minMargin });
      const score = metrics.macroF1 + metrics.unknownRecall * 0.2 + metrics.coverage * 0.05;
      if (!best || score > best.score) {
        best = { minConfidence, minMargin, score, metrics };
      }
    }
  }
  return best;
}
