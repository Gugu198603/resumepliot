"""Job application optimization layer for ResumePilot.

The logic is adapted from the public `job-application-optimizer` skill:
analyze_job -> score_match -> suggest_tailoring -> score_ats.
It is deterministic and only produces recommendations. It does not rewrite
resume facts, so it can safely run before a user confirms changes.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Sequence


STOPWORDS = {
    "and", "or", "the", "a", "an", "to", "of", "in", "for", "with", "on", "at", "by",
    "is", "are", "be", "as", "from", "you", "your", "we", "our", "will", "can", "have",
}
KEYWORD_NOISE = {
    "必须", "必须熟悉", "要求", "任职资格", "岗位职责", "优先", "加分", "加分项",
    "经验", "能力", "相关经验", "熟悉", "掌握", "了解", "具备", "负责",
}

REQUIRED_HINT_RE = re.compile(r"(required|must|minimum|至少|必须|要求|必备|任职资格|qualifications)", re.I)
PREFERRED_HINT_RE = re.compile(r"(preferred|plus|nice|加分|优先|bonus|加分项)", re.I)
YEARS_RE = re.compile(r"(\d+)\+?\s*(?:years?|年)")
TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9.+#-]{1,}|[\u4e00-\u9fff]{2,12}")
METRIC_RE = re.compile(r"\d+(?:\.\d+)?\s*(?:%|万|千|人|年|月|次|倍|ms|s|MB|GB|QPS|TPS)?")


@dataclass(frozen=True)
class KeywordBucket:
    primary: List[str] = field(default_factory=list)
    secondary: List[str] = field(default_factory=list)
    long_tail: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, List[str]]:
        return {
            "primary": self.primary,
            "secondary": self.secondary,
            "long_tail": self.long_tail,
        }


def _normalize(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def _dedupe(items: Sequence[str], limit: int) -> List[str]:
    output: List[str] = []
    seen = set()
    for item in items:
        value = str(item or "").strip(" ,，.;；:：()[]{}")
        value = re.sub(r"^(必须|要求|熟悉|掌握|了解|具备|优先|和|及|与)", "", value)
        value = re.sub(r"(经验|能力|相关经验)$", "", value)
        key = value.lower()
        if not value or key in seen or key in STOPWORDS or value in KEYWORD_NOISE:
            continue
        if len(value) < 2:
            continue
        seen.add(key)
        output.append(value)
        if len(output) >= limit:
            break
    return output


def _extract_tokens(text: str, limit: int = 80) -> List[str]:
    raw = [match.group(0) for match in TOKEN_RE.finditer(text or "")]
    return _dedupe(raw, limit)


def _line_keywords(lines: Sequence[str], hint_re: re.Pattern[str], limit: int) -> List[str]:
    matched: List[str] = []
    for line in lines:
        if hint_re.search(line):
            matched.extend(_extract_tokens(line, limit=20))
    return _dedupe(matched, limit)


def analyze_job_description(job_description: str) -> Dict[str, Any]:
    """Extract prioritized keywords and basic hard requirement signals."""

    text = str(job_description or "")
    lines = [line.strip() for line in re.split(r"[\n。；;]", text) if line.strip()]
    all_tokens = _extract_tokens(text)
    primary = _line_keywords(lines, REQUIRED_HINT_RE, 12)
    secondary = _line_keywords(lines, PREFERRED_HINT_RE, 16)

    if not primary:
        primary = all_tokens[:8]
    if not secondary:
        secondary = [token for token in all_tokens if token.lower() not in {item.lower() for item in primary}][:14]

    used = {item.lower() for item in [*primary, *secondary]}
    long_tail = [token for token in all_tokens if token.lower() not in used][:18]
    years = [int(match.group(1)) for match in YEARS_RE.finditer(text)]

    return {
        "keywords": KeywordBucket(
            primary=_dedupe(primary, 10),
            secondary=_dedupe(secondary, 15),
            long_tail=_dedupe(long_tail, 15),
        ).to_dict(),
        "minimumYears": max(years) if years else None,
        "redFlags": [line for line in lines if re.search(r"rockstar|ninja|996|抗压|狼性|大小周|随时待命", line, re.I)][:5],
    }


def _resume_corpus(json_resume: Mapping[str, Any]) -> str:
    return _normalize(json.dumps(json_resume, ensure_ascii=False))


def _match_keywords(corpus: str, keywords: Sequence[str]) -> List[str]:
    return [keyword for keyword in keywords if _normalize(keyword) in corpus]


def _missing_keywords(corpus: str, keywords: Sequence[str]) -> List[str]:
    return [keyword for keyword in keywords if _normalize(keyword) not in corpus]


def score_match(json_resume: Mapping[str, Any], job_analysis: Mapping[str, Any]) -> Dict[str, Any]:
    corpus = _resume_corpus(json_resume)
    keywords = job_analysis.get("keywords") or {}
    primary = list(keywords.get("primary") or [])
    secondary = list(keywords.get("secondary") or [])
    long_tail = list(keywords.get("long_tail") or [])

    primary_matched = _match_keywords(corpus, primary)
    secondary_matched = _match_keywords(corpus, secondary)
    long_tail_matched = _match_keywords(corpus, long_tail)

    def ratio(matched: Sequence[str], total: Sequence[str]) -> float:
        return len(matched) / len(total) if total else 1.0

    score = round(
        ratio(primary_matched, primary) * 60
        + ratio(secondary_matched, secondary) * 25
        + ratio(long_tail_matched, long_tail) * 15
    )

    return {
        "score": score,
        "matched": {
            "primary": primary_matched,
            "secondary": secondary_matched,
            "long_tail": long_tail_matched,
        },
        "missing": {
            "primary": _missing_keywords(corpus, primary),
            "secondary": _missing_keywords(corpus, secondary),
            "long_tail": _missing_keywords(corpus, long_tail),
        },
    }


def score_ats(json_resume: Mapping[str, Any], job_analysis: Mapping[str, Any]) -> Dict[str, Any]:
    corpus = _resume_corpus(json_resume)
    basics = json_resume.get("basics") or {}
    work = json_resume.get("work") or []
    skills = json_resume.get("skills") or []
    education = json_resume.get("education") or []
    projects = json_resume.get("projects") or []
    metrics = METRIC_RE.findall(corpus)

    checks = [
        {"id": "contact_info", "ok": bool(basics.get("email") or basics.get("phone")), "message": "Contact info is present at top-level basics."},
        {"id": "standard_sections", "ok": bool(work or projects) and bool(skills or education), "message": "Standard resume sections are present."},
        {"id": "quantified_achievements", "ok": len(metrics) >= 3, "message": "At least three quantifiable facts are present."},
        {"id": "skills_section", "ok": bool(skills), "message": "Dedicated skills section exists."},
        {"id": "summary_keywords", "ok": any(_normalize(k) in _normalize(basics.get("summary", "")) for k in (job_analysis.get("keywords", {}).get("primary") or [])[:5]), "message": "Top JD keywords appear in summary."},
    ]
    score = round(sum(20 for check in checks if check["ok"]))
    return {
        "score": score,
        "checks": checks,
        "quickWins": [check["message"] for check in checks if not check["ok"]],
    }


def _tailoring_level(match_score: int) -> Dict[str, str]:
    if match_score >= 80:
        return {"level": "LIGHT", "estimatedTime": "15 minutes", "risk": "none"}
    if match_score >= 60:
        return {"level": "MEDIUM", "estimatedTime": "30 minutes", "risk": "low"}
    if match_score >= 50:
        return {"level": "AGGRESSIVE", "estimatedTime": "1 hour", "risk": "medium"}
    return {"level": "BLOCKED", "estimatedTime": "review first", "risk": "high"}


def suggest_tailoring(match_report: Mapping[str, Any], ats_report: Mapping[str, Any], job_analysis: Mapping[str, Any]) -> List[str]:
    missing = match_report.get("missing") or {}
    actions: List[str] = []
    primary_missing = list(missing.get("primary") or [])
    secondary_missing = list(missing.get("secondary") or [])

    if primary_missing:
        actions.append(f"让用户确认是否真实具备这些核心要求，再加入摘要或经历：{', '.join(primary_missing[:5])}")
    if secondary_missing:
        actions.append(f"将可证明的次级关键词补到技能区或项目说明：{', '.join(secondary_missing[:6])}")
    if ats_report.get("quickWins"):
        actions.extend(ats_report["quickWins"][:3])
    if not actions:
        actions.append("当前匹配度较好，优先调整技能排序和摘要中的岗位标题精确匹配。")
    if job_analysis.get("redFlags"):
        actions.append("岗位描述存在潜在风险信号，建议在投递前人工评估工作强度和文化匹配。")
    return actions


def optimize_for_job(json_resume: Mapping[str, Any], job_description: str = "") -> Dict[str, Any]:
    if not str(job_description or "").strip():
        return {
            "available": False,
            "reason": "No job description was provided.",
            "agentChainHint": "multi-agent chain can run job optimization after JD retrieval.",
        }

    job_analysis = analyze_job_description(job_description)
    match_report = score_match(json_resume, job_analysis)
    ats_report = score_ats(json_resume, job_analysis)
    tailoring = _tailoring_level(int(match_report["score"]))
    recommendation = "APPLY" if match_report["score"] >= 65 else "CONSIDER" if match_report["score"] >= 50 else "SKIP_OR_COLLECT_MORE_EVIDENCE"

    return {
        "available": True,
        "source": "job-application-optimizer-adapted",
        "recommendation": recommendation,
        "tailoring": tailoring,
        "jobAnalysis": job_analysis,
        "match": match_report,
        "ats": ats_report,
        "actions": suggest_tailoring(match_report, ats_report, job_analysis),
        "agentChainHint": "planner -> jdMatcher -> resumeGenerationSkill.optimizer -> interviewer confirms facts -> resumeGenerationSkill.preview",
    }
