#!/usr/bin/env python3
"""Fine-tune a compact BGE encoder and compare it with frozen baselines."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

UNKNOWN_LABEL = "unknown"
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "training/configs/skill-router-bge-small-v1.json"
DEFAULT_DATASET = ROOT / "datasets/skill-router.v1.json"
DEFAULT_MODEL_OUTPUT = ROOT / ".model-artifacts/skill-router-bge-small-v1"
DEFAULT_REPORT = ROOT / "reports/skill-router-encoder-finetune.v1.json"
DEFAULT_MODEL_CARD = ROOT / "models/skill-router/encoder-finetune-v1.json"
DEFAULT_NAIVE_BAYES = ROOT / "models/skill-router/naive-bayes-v1.json"
DEFAULT_BGE_M3 = ROOT / "models/skill-router/embedding-comparison-v1.json"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_dataset(dataset: dict[str, Any]) -> dict[str, int]:
    labels = dataset.get("labels")
    if not dataset.get("id") or not dataset.get("version") or not isinstance(labels, list):
        raise ValueError("Dataset requires id, version and labels.")
    if UNKNOWN_LABEL not in labels:
        raise ValueError("Dataset labels must contain unknown.")
    seen: dict[str, str] = {}
    sizes: dict[str, int] = {}
    for split in ("train", "validation", "test"):
        examples = dataset.get(split)
        if not isinstance(examples, list) or not examples:
            raise ValueError(f"Dataset split {split} must not be empty.")
        sizes[split] = len(examples)
        for index, example in enumerate(examples):
            text = str(example.get("text", "")).strip()
            label = example.get("label")
            if not text or label not in labels:
                raise ValueError(f"Invalid {split} example at index {index}.")
            key = "".join(text.lower().split())
            if key in seen:
                raise ValueError(f"Dataset leakage between {seen[key]} and {split}.")
            seen[key] = split
    for label in labels:
        if not any(item["label"] == label for item in dataset["train"]):
            raise ValueError(f"Training split has no examples for {label}.")
    return sizes


def build_triplets(
    examples: list[dict[str, str]],
    labels: list[str],
) -> list[dict[str, str]]:
    """Build deterministic triplets without treating unrelated unknowns as positives."""
    known_labels = [label for label in labels if label != UNKNOWN_LABEL]
    by_label = {
        label: [item["text"] for item in examples if item["label"] == label]
        for label in labels
    }
    unknowns = by_label[UNKNOWN_LABEL]
    triplets: list[dict[str, str]] = []
    for label_index, label in enumerate(known_labels):
        items = by_label[label]
        negative_label = known_labels[(label_index + 1) % len(known_labels)]
        negatives = by_label[negative_label]
        for index, anchor in enumerate(items):
            positive = items[(index + 1) % len(items)]
            triplets.append({
                "anchor": anchor,
                "positive": positive,
                "negative": negatives[index % len(negatives)],
                "negativeType": "neighbor-skill",
            })
            triplets.append({
                "anchor": anchor,
                "positive": items[(index - 1) % len(items)],
                "negative": unknowns[index % len(unknowns)],
                "negativeType": "unknown",
            })
    return triplets


def dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right))


def normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(dot(vector, vector)) or 1.0
    return [value / norm for value in vector]


def softmax(values: list[float]) -> list[float]:
    highest = max(values)
    exponents = [math.exp(value - highest) for value in values]
    denominator = sum(exponents)
    return [value / denominator for value in exponents]


def train_prototype(
    examples: list[dict[str, str]],
    embeddings: list[list[float]],
    labels: list[str],
    temperature: float,
) -> dict[str, Any]:
    dimension = len(embeddings[0])
    sums = {label: [0.0] * dimension for label in labels}
    counts = {label: 0 for label in labels}
    for example, embedding in zip(examples, embeddings):
        counts[example["label"]] += 1
        for index, value in enumerate(embedding):
            sums[example["label"]][index] += value
    centroids = {
        label: normalize([value / max(1, counts[label]) for value in sums[label]])
        for label in labels
    }
    return {
        "type": "embedding-prototype",
        "labels": labels,
        "dimension": dimension,
        "temperature": temperature,
        "centroids": centroids,
    }


def predict_prototype(model: dict[str, Any], embedding: list[float]) -> dict[str, Any]:
    vector = normalize(embedding)
    scores = [dot(vector, model["centroids"][label]) for label in model["labels"]]
    probabilities = softmax([score / model["temperature"] for score in scores])
    ranked = sorted(
        [
            {"label": label, "probability": probability, "score": score}
            for label, probability, score in zip(model["labels"], probabilities, scores)
        ],
        key=lambda item: (-item["probability"], item["label"]),
    )
    return {
        "label": ranked[0]["label"],
        "confidence": ranked[0]["probability"],
        "margin": ranked[0]["probability"] - ranked[1]["probability"],
        "probabilities": ranked,
    }


def evaluate(
    examples: list[dict[str, str]],
    embeddings: list[list[float]],
    model: dict[str, Any],
    thresholds: dict[str, float],
) -> dict[str, Any]:
    labels = model["labels"]
    confusion = {
        actual: {predicted: 0 for predicted in labels}
        for actual in labels
    }
    predictions = []
    for example, embedding in zip(examples, embeddings):
        prediction = predict_prototype(model, embedding)
        rejected = (
            prediction["label"] == UNKNOWN_LABEL
            or prediction["confidence"] < thresholds["minConfidence"]
            or prediction["margin"] < thresholds["minMargin"]
        )
        label = UNKNOWN_LABEL if rejected else prediction["label"]
        confusion[example["label"]][label] += 1
        predictions.append({
            "text": example["text"],
            "actualLabel": example["label"],
            "label": label,
            "predictedLabel": prediction["label"],
            "confidence": round(prediction["confidence"], 6),
            "margin": round(prediction["margin"], 6),
            "rejected": rejected,
        })
    per_label = []
    for label in labels:
        true_positive = confusion[label][label]
        false_positive = sum(confusion[actual][label] for actual in labels if actual != label)
        false_negative = sum(confusion[label][predicted] for predicted in labels if predicted != label)
        precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0
        recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0
        per_label.append({
            "label": label,
            "precision": round(precision, 3),
            "recall": round(recall, 3),
            "f1": round(f1, 3),
            "support": true_positive + false_negative,
        })
    return {
        "total": len(examples),
        "accuracy": round(sum(item["label"] == item["actualLabel"] for item in predictions) / len(examples), 3),
        "macroF1": round(sum(item["f1"] for item in per_label) / len(per_label), 3),
        "unknownRecall": next(item["recall"] for item in per_label if item["label"] == UNKNOWN_LABEL),
        "coverage": round(sum(not item["rejected"] for item in predictions) / len(examples), 3),
        "confusion": confusion,
        "perLabel": per_label,
        "predictions": predictions,
    }


def calibrate(
    examples: list[dict[str, str]],
    embeddings: list[list[float]],
    model: dict[str, Any],
) -> dict[str, Any]:
    best: dict[str, Any] | None = None
    for min_confidence in (0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7):
        for min_margin in (0, 0.03, 0.05, 0.1, 0.15, 0.2):
            thresholds = {
                "minConfidence": min_confidence,
                "minMargin": min_margin,
            }
            metrics = evaluate(examples, embeddings, model, thresholds)
            score = metrics["macroF1"] + metrics["unknownRecall"] * 0.2 + metrics["coverage"] * 0.05
            if best is None or score > best["score"]:
                best = {"thresholds": thresholds, "score": score, "metrics": metrics}
    assert best is not None
    return best


def compact_metrics(metrics: dict[str, Any]) -> dict[str, Any]:
    return {
        key: metrics[key]
        for key in (
            "total",
            "accuracy",
            "macroF1",
            "unknownRecall",
            "coverage",
            "confusion",
            "perLabel",
            "predictions",
        )
    }


def locate_transformer_layers(model: Any) -> list[Any]:
    candidates = [
        getattr(getattr(model, "encoder", None), "layer", None),
        getattr(getattr(model, "transformer", None), "layer", None),
        getattr(model, "layers", None),
    ]
    for candidate in candidates:
        if candidate is not None and len(candidate):
            return list(candidate)
    raise RuntimeError("Unable to locate transformer layers for partial encoder fine-tuning.")


def select_device(torch: Any) -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def encode_texts(
    model: Any,
    tokenizer: Any,
    texts: list[str],
    *,
    torch: Any,
    device: str,
    batch_size: int,
    max_length: int,
    with_grad: bool = False,
) -> Any:
    import torch.nn.functional as functional

    outputs = []
    context = torch.enable_grad if with_grad else torch.no_grad
    for start in range(0, len(texts), batch_size):
        batch = texts[start:start + batch_size]
        encoded = tokenizer(
            batch,
            padding=True,
            truncation=True,
            max_length=max_length,
            return_tensors="pt",
        )
        encoded = {key: value.to(device) for key, value in encoded.items()}
        with context():
            hidden = model(**encoded).last_hidden_state[:, 0]
            outputs.append(functional.normalize(hidden, p=2, dim=1))
    return torch.cat(outputs, dim=0)


def evaluate_encoder(
    model: Any,
    tokenizer: Any,
    dataset: dict[str, Any],
    config: dict[str, Any],
    *,
    torch: Any,
    device: str,
) -> dict[str, Any]:
    model.eval()
    started_at = time.perf_counter()
    split_embeddings = {}
    for split in ("train", "validation", "test"):
        tensor = encode_texts(
            model,
            tokenizer,
            [item["text"] for item in dataset[split]],
            torch=torch,
            device=device,
            batch_size=config["encodeBatchSize"],
            max_length=config["maxLength"],
        )
        split_embeddings[split] = tensor.detach().cpu().tolist()
    encoding_ms = (time.perf_counter() - started_at) * 1000
    prototype = train_prototype(
        dataset["train"],
        split_embeddings["train"],
        dataset["labels"],
        config["prototypeTemperature"],
    )
    calibration = calibrate(dataset["validation"], split_embeddings["validation"], prototype)
    test_metrics = evaluate(
        dataset["test"],
        split_embeddings["test"],
        prototype,
        calibration["thresholds"],
    )
    total_examples = sum(len(dataset[split]) for split in ("train", "validation", "test"))
    return {
        "thresholds": calibration["thresholds"],
        "validationMetrics": compact_metrics(calibration["metrics"]),
        "testMetrics": compact_metrics(test_metrics),
        "prototype": prototype,
        "latency": {
            "examplesEncoded": total_examples,
            "totalEncodingMs": round(encoding_ms, 3),
            "encodingMsPerItem": round(encoding_ms / total_examples, 3),
        },
    }


def train_encoder(
    model: Any,
    tokenizer: Any,
    triplets: list[dict[str, str]],
    dataset: dict[str, Any],
    config: dict[str, Any],
    *,
    torch: Any,
    device: str,
) -> dict[str, Any]:
    import torch.nn.functional as functional

    for parameter in model.parameters():
        parameter.requires_grad = False
    layers = locate_transformer_layers(model)
    trainable_layers = layers[-config["trainableLastLayers"]:]
    for layer in trainable_layers:
        for parameter in layer.parameters():
            parameter.requires_grad = True
    trainable_parameters = [parameter for parameter in model.parameters() if parameter.requires_grad]
    optimizer = torch.optim.AdamW(
        trainable_parameters,
        lr=config["learningRate"],
        weight_decay=config["weightDecay"],
    )
    history = []
    best_epoch = 0
    best_score = float("-inf")
    best_state = None
    for epoch in range(config["epochs"]):
        model.train()
        shuffled = list(triplets)
        random.Random(config["seed"] + epoch).shuffle(shuffled)
        losses = []
        started_at = time.perf_counter()
        for start in range(0, len(shuffled), config["batchSize"]):
            batch = shuffled[start:start + config["batchSize"]]
            texts = (
                [item["anchor"] for item in batch]
                + [item["positive"] for item in batch]
                + [item["negative"] for item in batch]
            )
            embeddings = encode_texts(
                model,
                tokenizer,
                texts,
                torch=torch,
                device=device,
                batch_size=len(texts),
                max_length=config["maxLength"],
                with_grad=True,
            )
            size = len(batch)
            anchors = embeddings[:size]
            positives = embeddings[size:size * 2]
            negatives = embeddings[size * 2:]
            positive_distance = 1 - functional.cosine_similarity(anchors, positives)
            negative_distance = 1 - functional.cosine_similarity(anchors, negatives)
            loss = functional.relu(
                positive_distance - negative_distance + config["margin"]
            ).mean()
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(trainable_parameters, max_norm=1.0)
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        validation = evaluate_encoder(
            model,
            tokenizer,
            dataset,
            config,
            torch=torch,
            device=device,
        )
        validation_metrics = validation["validationMetrics"]
        selection_score = (
            validation_metrics["macroF1"]
            + validation_metrics["unknownRecall"] * 0.2
            + validation_metrics["coverage"] * 0.05
        )
        history.append({
            "epoch": epoch + 1,
            "loss": round(sum(losses) / len(losses), 6),
            "durationSeconds": round(time.perf_counter() - started_at, 3),
            "validationMetrics": metric_summary(validation_metrics),
            "selectionScore": round(selection_score, 6),
        })
        if selection_score > best_score:
            best_epoch = epoch + 1
            best_score = selection_score
            best_state = {
                name: parameter.detach().cpu().clone()
                for name, parameter in model.named_parameters()
                if parameter.requires_grad
            }
        print(json.dumps(history[-1], ensure_ascii=False), flush=True)
    assert best_state is not None
    for name, parameter in model.named_parameters():
        if name in best_state:
            parameter.data.copy_(best_state[name].to(device))
    return {
        "history": history,
        "bestEpoch": best_epoch,
        "bestValidationScore": round(best_score, 6),
        "totalParameters": sum(parameter.numel() for parameter in model.parameters()),
        "trainableParameters": sum(parameter.numel() for parameter in trainable_parameters),
        "trainableLayers": len(trainable_layers),
    }


def metric_summary(metrics: dict[str, Any]) -> dict[str, Any]:
    return {
        key: metrics[key]
        for key in ("accuracy", "macroF1", "unknownRecall", "coverage")
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--model-output", type=Path, default=DEFAULT_MODEL_OUTPUT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--model-card", type=Path, default=DEFAULT_MODEL_CARD)
    parser.add_argument("--epochs", type=int)
    parser.add_argument("--learning-rate", type=float)
    parser.add_argument("--margin", type=float)
    parser.add_argument("--trainable-last-layers", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    config = read_json(args.config)
    overrides = {
        "epochs": args.epochs,
        "learningRate": args.learning_rate,
        "margin": args.margin,
        "trainableLastLayers": args.trainable_last_layers,
    }
    config.update({key: value for key, value in overrides.items() if value is not None})
    dataset_raw = args.dataset.read_bytes()
    dataset = json.loads(dataset_raw)
    split_sizes = validate_dataset(dataset)
    triplets = build_triplets(dataset["train"], dataset["labels"])
    preparation = {
        "dataset": dataset["id"],
        "version": dataset["version"],
        "splits": split_sizes,
        "triplets": len(triplets),
        "neighborSkillNegatives": sum(item["negativeType"] == "neighbor-skill" for item in triplets),
        "unknownNegatives": sum(item["negativeType"] == "unknown" for item in triplets),
    }
    if args.dry_run:
        print(json.dumps(preparation, ensure_ascii=False, indent=2))
        return 0

    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    import torch
    from transformers import AutoModel, AutoTokenizer

    random.seed(config["seed"])
    torch.manual_seed(config["seed"])
    device = select_device(torch)
    print(json.dumps({"phase": "load-model", "model": config["baseModel"], "device": device}), flush=True)
    tokenizer = AutoTokenizer.from_pretrained(config["baseModel"])
    model = AutoModel.from_pretrained(config["baseModel"]).to(device)

    print(json.dumps({"phase": "evaluate-frozen"}), flush=True)
    frozen = evaluate_encoder(model, tokenizer, dataset, config, torch=torch, device=device)
    print(json.dumps({"frozen": metric_summary(frozen["testMetrics"])}, ensure_ascii=False), flush=True)

    print(json.dumps({"phase": "fine-tune", **preparation}), flush=True)
    training = train_encoder(
        model,
        tokenizer,
        triplets,
        dataset,
        config,
        torch=torch,
        device=device,
    )

    print(json.dumps({"phase": "evaluate-fine-tuned"}), flush=True)
    fine_tuned = evaluate_encoder(model, tokenizer, dataset, config, torch=torch, device=device)
    print(json.dumps({"fineTuned": metric_summary(fine_tuned["testMetrics"])}, ensure_ascii=False), flush=True)

    args.model_output.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.model_output, safe_serialization=True)
    tokenizer.save_pretrained(args.model_output)

    naive_bayes = read_json(DEFAULT_NAIVE_BAYES)
    bge_m3 = read_json(DEFAULT_BGE_M3)
    gate = config["qualityGate"]
    eligible = (
        fine_tuned["testMetrics"]["macroF1"]
        >= frozen["testMetrics"]["macroF1"] - gate["maxMacroF1Regression"]
        and fine_tuned["testMetrics"]["unknownRecall"] >= gate["minUnknownRecall"]
    )
    relative_artifact = os.path.relpath(args.model_output.resolve(), ROOT)
    created_at = datetime.now(timezone.utc).isoformat()
    report = {
        "experiment": config["experimentId"],
        "version": config["version"],
        "createdAt": created_at,
        "dataset": {
            "id": dataset["id"],
            "version": dataset["version"],
            "sha256": hashlib.sha256(dataset_raw).hexdigest(),
            **preparation,
        },
        "encoder": {
            "baseModel": config["baseModel"],
            "pooling": "cls",
            "normalize": True,
            "modelArtifact": relative_artifact,
            "device": device,
        },
        "training": {
            **{key: config[key] for key in (
                "seed",
                "maxLength",
                "batchSize",
                "epochs",
                "learningRate",
                "weightDecay",
                "margin",
                "trainableLastLayers",
            )},
            **training,
        },
        "models": [
            {
                "name": "naive-bayes-char-ngram",
                "source": "models/skill-router/naive-bayes-v1.json",
                "testMetrics": metric_summary(naive_bayes["testMetrics"]),
            },
            {
                "name": "bge-m3-frozen-prototype",
                "source": "models/skill-router/embedding-comparison-v1.json",
                "testMetrics": metric_summary(bge_m3["prototype"]["testMetrics"]),
            },
            {
                "name": "bge-small-zh-v1.5-frozen-prototype",
                **frozen,
            },
            {
                "name": "bge-small-zh-v1.5-fine-tuned-encoder-prototype",
                **fine_tuned,
            },
        ],
        "qualityGate": {
            **gate,
            "eligibleForShadow": eligible,
            "decision": "shadow" if eligible else "reject",
        },
        "notes": [
            "The fine-tuned candidate updates real encoder weights; it is not a classifier-head-only experiment.",
            "Unknown examples are used as negatives and for threshold calibration, never as positive semantic pairs.",
            "Production routing is unchanged until a shadow evaluation is explicitly promoted.",
        ],
        "environment": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "transformers": __import__("transformers").__version__,
            "platform": platform.platform(),
        },
    }
    write_json(args.report, report)
    model_card = {
        "id": "resumepilot-skill-router-encoder-finetune",
        "version": config["version"],
        "createdAt": created_at,
        "dataset": report["dataset"],
        "baseModel": config["baseModel"],
        "artifact": relative_artifact,
        "training": {
            "objective": "cosine-triplet-margin",
            "trainableLastLayers": config["trainableLastLayers"],
            "triplets": len(triplets),
        },
        "frozenTestMetrics": metric_summary(frozen["testMetrics"]),
        "fineTunedTestMetrics": metric_summary(fine_tuned["testMetrics"]),
        "qualityGate": report["qualityGate"],
        "report": os.path.relpath(args.report.resolve(), ROOT),
    }
    write_json(args.model_card, model_card)
    print(json.dumps({
        "report": str(args.report),
        "modelCard": str(args.model_card),
        "artifact": str(args.model_output),
        "qualityGate": report["qualityGate"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
