const UNKNOWN_LABEL = 'unknown';

function dot(a, b) {
  let value = 0;
  for (let index = 0; index < a.length; index += 1) value += a[index] * b[index];
  return value;
}

function normalizeVector(vector) {
  const norm = Math.sqrt(dot(vector, vector)) || 1;
  return Array.from(vector, (value) => value / norm);
}

function softmaxScores(scores, temperature = 1) {
  const scaled = scores.map((item) => ({ ...item, value: item.value / temperature }));
  const max = Math.max(...scaled.map((item) => item.value));
  const denominator = scaled.reduce((sum, item) => sum + Math.exp(item.value - max), 0);
  return scaled
    .map((item) => ({
      label: item.label,
      probability: Math.exp(item.value - max) / denominator,
      score: item.value * temperature
    }))
    .sort((a, b) => b.probability - a.probability || a.label.localeCompare(b.label));
}

function predictionFromProbabilities(probabilities) {
  return {
    label: probabilities[0]?.label || UNKNOWN_LABEL,
    confidence: probabilities[0]?.probability || 0,
    margin: (probabilities[0]?.probability || 0) - (probabilities[1]?.probability || 0),
    probabilities
  };
}

export function trainPrototypeClassifier(examples, embeddings, labels, { temperature = 0.08 } = {}) {
  if (examples.length !== embeddings.length) throw new Error('Prototype examples and embeddings must have equal length.');
  const dimension = embeddings[0]?.length || 0;
  const sums = Object.fromEntries(labels.map((label) => [label, new Float64Array(dimension)]));
  const counts = Object.fromEntries(labels.map((label) => [label, 0]));
  examples.forEach((example, exampleIndex) => {
    counts[example.label] += 1;
    const embedding = embeddings[exampleIndex];
    for (let index = 0; index < dimension; index += 1) sums[example.label][index] += embedding[index];
  });
  const centroids = Object.fromEntries(labels.map((label) => [
    label,
    normalizeVector(Array.from(sums[label], (value) => value / Math.max(1, counts[label])))
  ]));
  return {
    type: 'embedding-prototype',
    labels,
    dimension,
    temperature,
    centroids
  };
}

export function predictPrototype(model, embedding) {
  const normalized = normalizeVector(embedding);
  return predictionFromProbabilities(softmaxScores(
    model.labels.map((label) => ({ label, value: dot(normalized, model.centroids[label]) })),
    model.temperature
  ));
}

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const denominator = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / denominator);
}

export function trainLinearClassifier(examples, embeddings, labels, {
  epochs = 240,
  learningRate = 0.35,
  l2 = 0.0005
} = {}) {
  if (examples.length !== embeddings.length) throw new Error('Linear examples and embeddings must have equal length.');
  const dimension = embeddings[0]?.length || 0;
  const weights = labels.map(() => new Float64Array(dimension));
  const bias = new Float64Array(labels.length);
  const labelIndex = new Map(labels.map((label, index) => [label, index]));

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradWeights = labels.map(() => new Float64Array(dimension));
    const gradBias = new Float64Array(labels.length);
    for (let row = 0; row < embeddings.length; row += 1) {
      const vector = embeddings[row];
      const probabilities = softmax(weights.map((weight, index) => dot(weight, vector) + bias[index]));
      const target = labelIndex.get(examples[row].label);
      for (let label = 0; label < labels.length; label += 1) {
        const error = probabilities[label] - (label === target ? 1 : 0);
        gradBias[label] += error;
        for (let column = 0; column < dimension; column += 1) {
          gradWeights[label][column] += error * vector[column];
        }
      }
    }
    const scale = learningRate / embeddings.length;
    for (let label = 0; label < labels.length; label += 1) {
      bias[label] -= scale * gradBias[label];
      for (let column = 0; column < dimension; column += 1) {
        weights[label][column] -= scale * (gradWeights[label][column] + l2 * weights[label][column]);
      }
    }
  }

  return {
    type: 'frozen-embedding-softmax-head',
    labels,
    dimension,
    epochs,
    learningRate,
    l2,
    weights: weights.map((row) => Array.from(row)),
    bias: Array.from(bias)
  };
}

export function predictLinear(model, embedding) {
  const probabilities = softmax(
    model.weights.map((weight, index) => dot(weight, embedding) + model.bias[index])
  );
  return predictionFromProbabilities(
    model.labels
      .map((label, index) => ({ label, probability: probabilities[index] }))
      .sort((a, b) => b.probability - a.probability || a.label.localeCompare(b.label))
  );
}

export function rejectEmbeddingPrediction(prediction, thresholds = {}) {
  const minConfidence = Number(thresholds.minConfidence ?? 0.4);
  const minMargin = Number(thresholds.minMargin ?? 0.1);
  const rejected = prediction.label === UNKNOWN_LABEL ||
    prediction.confidence < minConfidence ||
    prediction.margin < minMargin;
  return {
    ...prediction,
    predictedLabel: prediction.label,
    label: rejected ? UNKNOWN_LABEL : prediction.label,
    rejected
  };
}

export function evaluateEmbeddingClassifier(examples, embeddings, predict, thresholds = {}) {
  const labels = [...new Set(examples.map((item) => item.label))];
  const confusion = Object.fromEntries(labels.map((actual) => [
    actual,
    Object.fromEntries(labels.map((predicted) => [predicted, 0]))
  ]));
  const predictions = examples.map((example, index) => {
    const result = rejectEmbeddingPrediction(predict(embeddings[index]), thresholds);
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
    accuracy: Number((predictions.filter((item) => item.label === item.actualLabel).length / examples.length).toFixed(3)),
    macroF1: Number((perLabel.reduce((sum, item) => sum + item.f1, 0) / labels.length).toFixed(3)),
    unknownRecall: Number((perLabel.find((item) => item.label === UNKNOWN_LABEL)?.recall || 0).toFixed(3)),
    coverage: Number((predictions.filter((item) => !item.rejected).length / examples.length).toFixed(3)),
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

export function calibrateEmbeddingClassifier(examples, embeddings, predict) {
  let best = null;
  for (const minConfidence of [0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7]) {
    for (const minMargin of [0, 0.03, 0.05, 0.1, 0.15, 0.2]) {
      const metrics = evaluateEmbeddingClassifier(examples, embeddings, predict, { minConfidence, minMargin });
      const score = metrics.macroF1 + metrics.unknownRecall * 0.2 + metrics.coverage * 0.05;
      if (!best || score > best.score) {
        best = { thresholds: { minConfidence, minMargin }, score, metrics };
      }
    }
  }
  return best;
}
