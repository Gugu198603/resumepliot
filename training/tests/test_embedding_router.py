import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "train_embedding_router.py"
SPEC = importlib.util.spec_from_file_location("train_embedding_router", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class EmbeddingRouterTrainingTest(unittest.TestCase):
    def setUp(self):
        self.dataset = {
            "id": "test",
            "version": "1",
            "labels": ["a", "b", "unknown"],
            "train": [
                {"text": "a one", "label": "a"},
                {"text": "a two", "label": "a"},
                {"text": "b one", "label": "b"},
                {"text": "b two", "label": "b"},
                {"text": "other one", "label": "unknown"},
                {"text": "other two", "label": "unknown"},
            ],
            "validation": [
                {"text": "a validation", "label": "a"},
                {"text": "b validation", "label": "b"},
                {"text": "other validation", "label": "unknown"},
            ],
            "test": [
                {"text": "a test", "label": "a"},
                {"text": "b test", "label": "b"},
                {"text": "other test", "label": "unknown"},
            ],
        }

    def test_dataset_validation_and_triplets(self):
        sizes = MODULE.validate_dataset(self.dataset)
        triplets = MODULE.build_triplets(self.dataset["train"], self.dataset["labels"])
        self.assertEqual(sizes, {"train": 6, "validation": 3, "test": 3})
        self.assertEqual(len(triplets), 8)
        self.assertEqual(sum(item["negativeType"] == "unknown" for item in triplets), 4)
        unknown_texts = {
            item["text"] for item in self.dataset["train"] if item["label"] == "unknown"
        }
        self.assertTrue(all(item["positive"] not in unknown_texts for item in triplets))

    def test_prototype_metrics_and_rejection(self):
        embeddings = [
            [1.0, 0.0],
            [0.9, 0.1],
            [0.0, 1.0],
            [0.1, 0.9],
            [-1.0, -1.0],
            [-0.9, -1.0],
        ]
        model = MODULE.train_prototype(
            self.dataset["train"],
            embeddings,
            self.dataset["labels"],
            0.08,
        )
        metrics = MODULE.evaluate(
            self.dataset["test"],
            [[1.0, 0.0], [0.0, 1.0], [-1.0, -1.0]],
            model,
            {"minConfidence": 0.4, "minMargin": 0.1},
        )
        self.assertEqual(metrics["accuracy"], 1.0)
        self.assertEqual(metrics["unknownRecall"], 1.0)

    def test_duplicate_text_across_splits_is_rejected(self):
        self.dataset["test"][0]["text"] = "a one"
        with self.assertRaisesRegex(ValueError, "leakage"):
            MODULE.validate_dataset(self.dataset)


if __name__ == "__main__":
    unittest.main()
