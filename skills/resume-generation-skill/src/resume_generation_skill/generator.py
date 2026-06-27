"""Orchestration shell for ResumePilot resume generation."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Mapping, Optional

from .career_profile import JsonDict
from .fact_validator import FactValidationReport, FactValidator
from .json_resume import career_profile_to_json_resume


@dataclass(frozen=True)
class GenerationResult:
    ok: bool
    resume: JsonDict
    profile_validation: FactValidationReport
    resume_validation: FactValidationReport
    output_path: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "resume": self.resume,
            "profile_validation": self.profile_validation.to_dict(),
            "resume_validation": self.resume_validation.to_dict(),
            "output_path": self.output_path,
        }


class ResumeGenerationSkill:
    """Generate JSON Resume only when all facts are evidence-backed."""

    def generate_resume_json(self, career_profile: Mapping[str, Any], output_path: Optional[str] = None) -> GenerationResult:
        validator = FactValidator.from_profile(career_profile)
        profile_report = validator.validate_career_profile(career_profile)
        if not profile_report.ok:
            return GenerationResult(
                ok=False,
                resume={},
                profile_validation=profile_report,
                resume_validation=FactValidationReport(ok=False, issues=[]),
                output_path=None,
            )

        resume = career_profile_to_json_resume(career_profile)
        resume_report = validator.validate_json_resume(resume)
        if not resume_report.ok:
            return GenerationResult(
                ok=False,
                resume=resume,
                profile_validation=profile_report,
                resume_validation=resume_report,
                output_path=None,
            )

        written_path = None
        if output_path:
            path = Path(output_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(resume, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            written_path = str(path)

        return GenerationResult(
            ok=True,
            resume=resume,
            profile_validation=profile_report,
            resume_validation=resume_report,
            output_path=written_path,
        )
