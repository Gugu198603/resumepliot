"""Evidence-backed fact validation for generated resumes."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from .career_profile import as_dict, as_list, source_ids_for


APPROVED_EVIDENCE_KINDS = {"original_resume", "resume", "conversation_confirmation", "confirmed_conversation"}
IGNORED_KEYS = {"evidence", "source_ids", "sourceIds", "evidence_ids", "evidenceIds", "meta", "metadata"}

URL_RE = re.compile(r"https?://[^\s)]+", re.I)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
DATE_RE = re.compile(r"\b(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?\b")
METRIC_RE = re.compile(r"(?<![\w.])(?:[$￥]\s*)?\d+(?:\.\d+)?\s*(?:%|k|K|m|M|万|千|人|年|月|天|次|倍|ms|s|MB|GB|QPS|TPS)?")
EN_FACT_RE = re.compile(r"\b[A-Za-z][A-Za-z0-9.+#-]{1,}\b")
CJK_FACT_RE = re.compile(r"[\u4e00-\u9fff]{2,20}")


def normalize_text(text: Any) -> str:
    value = str(text or "")
    value = re.sub(r"\b((?:19|20)\d{2})[./](\d{1,2})(?:[./](\d{1,2}))?\b", lambda m: "-".join(part for part in m.groups() if part), value)
    return re.sub(r"\s+", " ", value).strip().lower()


def _contains(haystack: str, needle: str) -> bool:
    normalized_needle = normalize_text(needle)
    return bool(normalized_needle) and normalized_needle in haystack


def _extract_protected_tokens(text: str) -> List[str]:
    tokens: List[str] = []
    for regex in (URL_RE, EMAIL_RE, DATE_RE, METRIC_RE, EN_FACT_RE, CJK_FACT_RE):
        tokens.extend(match.group(0).strip() for match in regex.finditer(text or ""))

    filtered: List[str] = []
    seen = set()
    for token in tokens:
        normalized = normalize_text(token)
        if not normalized or normalized in seen:
            continue
        if len(normalized) <= 1:
            continue
        # Keep English words that are likely factual: acronyms, tools, product
        # names, URLs, emails, dates, or terms with digits/symbols.
        if EN_FACT_RE.fullmatch(token) and token.islower() and len(token) < 4:
            continue
        seen.add(normalized)
        filtered.append(token)
    return filtered


@dataclass(frozen=True)
class EvidenceSource:
    id: str
    kind: str
    text: str
    confirmed: bool = True

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "EvidenceSource":
        return cls(
            id=str(data.get("id") or data.get("source_id") or data.get("sourceId") or ""),
            kind=str(data.get("kind") or data.get("type") or ""),
            text=str(data.get("text") or data.get("content") or ""),
            confirmed=bool(data.get("confirmed", True)),
        )

    @property
    def approved(self) -> bool:
        return bool(self.id and self.text and self.confirmed and self.kind in APPROVED_EVIDENCE_KINDS)


@dataclass(frozen=True)
class FactValidationIssue:
    path: str
    code: str
    message: str
    value: str = ""
    unsupported_tokens: List[str] = field(default_factory=list)
    source_ids: List[str] = field(default_factory=list)


@dataclass(frozen=True)
class FactValidationReport:
    ok: bool
    issues: List[FactValidationIssue]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "issues": [
                {
                    "path": issue.path,
                    "code": issue.code,
                    "message": issue.message,
                    "value": issue.value,
                    "unsupported_tokens": issue.unsupported_tokens,
                    "source_ids": issue.source_ids,
                }
                for issue in self.issues
            ],
        }


class FactValidator:
    """Validate that resume facts are grounded in approved evidence.

    The validator is intentionally conservative around protected facts: names,
    companies, dates, metrics, URLs, emails, project names, tools, and Chinese
    noun-like chunks must be present in original resume evidence or explicitly
    confirmed conversation evidence.
    """

    def __init__(self, evidence: Sequence[EvidenceSource]) -> None:
        self.evidence_by_id = {item.id: item for item in evidence if item.id}
        self.approved_by_id = {item.id: item for item in evidence if item.approved}
        self.approved_corpus = normalize_text("\n".join(item.text for item in self.approved_by_id.values()))

    @classmethod
    def from_profile(cls, profile: Mapping[str, Any]) -> "FactValidator":
        evidence = [EvidenceSource.from_dict(as_dict(item)) for item in as_list(profile.get("evidence"))]
        return cls(evidence)

    def validate_career_profile(self, profile: Mapping[str, Any]) -> FactValidationReport:
        return self._validate_mapping(profile, "$")

    def validate_json_resume(self, resume: Mapping[str, Any]) -> FactValidationReport:
        return self._validate_mapping(resume, "$")

    def _validate_mapping(self, data: Mapping[str, Any], root: str) -> FactValidationReport:
        issues: List[FactValidationIssue] = []

        if not self.approved_by_id:
            issues.append(
                FactValidationIssue(
                    path=root,
                    code="NO_APPROVED_EVIDENCE",
                    message="No approved resume or user-confirmed conversation evidence was provided.",
                )
            )
            return FactValidationReport(ok=False, issues=issues)

        for path, value, inherited_source_ids in self._walk(data, root, []):
            issues.extend(self._validate_value(path, value, inherited_source_ids))

        return FactValidationReport(ok=not issues, issues=issues)

    def _walk(self, value: Any, path: str, inherited_source_ids: List[str]) -> Iterable[Tuple[str, str, List[str]]]:
        if isinstance(value, Mapping):
            current_source_ids = source_ids_for(value, inherited_source_ids)
            for key, nested in value.items():
                if key in IGNORED_KEYS:
                    continue
                yield from self._walk(nested, f"{path}.{key}", current_source_ids)
            return

        if isinstance(value, list):
            for index, nested in enumerate(value):
                yield from self._walk(nested, f"{path}[{index}]", inherited_source_ids)
            return

        if isinstance(value, str) and value.strip():
            yield path, value.strip(), inherited_source_ids

    def _validate_value(self, path: str, value: str, source_ids: List[str]) -> List[FactValidationIssue]:
        issues: List[FactValidationIssue] = []
        source_corpus = self._source_corpus(source_ids)

        if source_ids:
            missing_or_unapproved = [source_id for source_id in source_ids if source_id not in self.approved_by_id]
            if missing_or_unapproved:
                issues.append(
                    FactValidationIssue(
                        path=path,
                        code="UNAPPROVED_SOURCE",
                        message="The value references evidence that is missing, unconfirmed, or not allowed.",
                        value=value,
                        source_ids=missing_or_unapproved,
                    )
                )

        if _contains(source_corpus, value):
            return issues

        protected_tokens = _extract_protected_tokens(value)
        unsupported = [token for token in protected_tokens if not _contains(source_corpus, token)]
        if unsupported:
            issues.append(
                FactValidationIssue(
                    path=path,
                    code="UNSUPPORTED_FACT",
                    message="The value contains protected facts not found in approved evidence.",
                    value=value,
                    unsupported_tokens=unsupported,
                    source_ids=source_ids,
                )
            )

        return issues

    def _source_corpus(self, source_ids: Optional[List[str]]) -> str:
        if not source_ids:
            return self.approved_corpus
        return normalize_text("\n".join(self.approved_by_id[source_id].text for source_id in source_ids if source_id in self.approved_by_id))
