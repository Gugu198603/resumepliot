"""Small stdin/stdout bridge for the Node.js server."""

from __future__ import annotations

import json
import sys

from .generator import ResumeGenerationSkill


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        profile = payload.get("careerProfile") or payload
        output_path = payload.get("outputPath")
        result = ResumeGenerationSkill().generate_resume_json(profile, output_path)
        print(json.dumps(result.to_dict(), ensure_ascii=False))
        return 0 if result.ok else 2
    except Exception as error:  # pragma: no cover - defensive CLI boundary
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
