"""Small stdin/stdout bridge for the Node.js server."""

from __future__ import annotations

import json
import sys

from .generator import ResumeGenerationSkill
from .fact_validator import FactValidator


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        profile = payload.get("careerProfile") or payload
        output_path = payload.get("outputPath")
        job_description = payload.get("jobDescription") or payload.get("jdText") or ""
        if payload.get("action") == "validate":
            validator = FactValidator.from_profile(profile)
            profile_report = validator.validate_career_profile(profile)
            resume_report = validator.validate_json_resume(payload.get("resume") or {})
            print(json.dumps({
                "ok": profile_report.ok and resume_report.ok,
                "profile_validation": profile_report.to_dict(),
                "resume_validation": resume_report.to_dict(),
            }, ensure_ascii=False))
            return 0 if profile_report.ok and resume_report.ok else 2
        result = ResumeGenerationSkill().generate_resume_json(profile, output_path, job_description=job_description)
        print(json.dumps(result.to_dict(), ensure_ascii=False))
        return 0 if result.ok else 2
    except Exception as error:  # pragma: no cover - defensive CLI boundary
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
