"""Convert ResumePilot CareerProfile dictionaries to JSON Resume.

This module intentionally has no LLM calls. It is safe to unit test and reuse
from a Node service through a small Python subprocess wrapper.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from .career_profile import JsonDict, as_dict, as_list, compact_dict, get_first, text_for


def _location(raw: Mapping[str, Any]) -> JsonDict:
    location = as_dict(raw.get("location"))
    if not location and raw.get("city"):
        location = {"city": raw.get("city")}
    return compact_dict(
        {
            "address": get_first(location, ["address"]),
            "postalCode": get_first(location, ["postalCode", "postal_code"]),
            "city": get_first(location, ["city"]),
            "countryCode": get_first(location, ["countryCode", "country_code"]),
            "region": get_first(location, ["region", "province", "state"]),
        }
    )


def _profiles(raw: Mapping[str, Any]) -> List[JsonDict]:
    profiles = []
    for item in as_list(raw.get("profiles")):
        data = as_dict(item)
        network = get_first(data, ["network", "type", "platform"])
        username = get_first(data, ["username", "handle", "name"])
        url = get_first(data, ["url", "link"])
        profiles.append(compact_dict({"network": network, "username": username, "url": url}))

    linkedin = get_first(raw, ["linkedin", "linkedIn"])
    github = get_first(raw, ["github", "gitHub"])
    if linkedin and not any(item.get("network", "").lower() == "linkedin" for item in profiles):
        profiles.append(compact_dict({"network": "LinkedIn", "url": linkedin}))
    if github and not any(item.get("network", "").lower() == "github" for item in profiles):
        profiles.append(compact_dict({"network": "GitHub", "url": github}))
    return [item for item in profiles if item]


def _basics(profile: Mapping[str, Any]) -> JsonDict:
    raw = as_dict(profile.get("basics") or profile.get("personal") or profile.get("contact"))
    return compact_dict(
        {
            "name": get_first(raw, ["name", "fullName", "full_name"]),
            "label": get_first(raw, ["label", "headline", "targetRole", "target_role"]),
            "image": get_first(raw, ["image", "avatar"]),
            "email": get_first(raw, ["email"]),
            "phone": get_first(raw, ["phone", "mobile"]),
            "url": get_first(raw, ["url", "website", "homepage"]),
            "summary": get_first(raw, ["summary", "profile", "about"]),
            "location": _location(raw),
            "profiles": _profiles(raw),
        }
    )


def _date(value: Any) -> str:
    if value in (None, ""):
        return ""
    return str(value).replace("/", "-").strip()


def _highlights(raw_item: Mapping[str, Any]) -> List[str]:
    highlights = []
    for item in as_list(raw_item.get("highlights") or raw_item.get("bullets")):
        text = text_for(item, "text", "summary", "description")
        if text:
            highlights.append(text)
    return highlights


def _work_item(item: Any) -> JsonDict:
    raw = as_dict(item)
    return compact_dict(
        {
            "name": get_first(raw, ["name", "company", "employer"]),
            "position": get_first(raw, ["position", "title", "role"]),
            "url": get_first(raw, ["url", "website"]),
            "startDate": _date(get_first(raw, ["startDate", "start_date", "from"])),
            "endDate": _date(get_first(raw, ["endDate", "end_date", "to"])),
            "summary": get_first(raw, ["summary", "description"]),
            "highlights": _highlights(raw),
        }
    )


def _education_item(item: Any) -> JsonDict:
    raw = as_dict(item)
    return compact_dict(
        {
            "institution": get_first(raw, ["institution", "school", "university"]),
            "url": get_first(raw, ["url", "website"]),
            "area": get_first(raw, ["area", "major", "field"]),
            "studyType": get_first(raw, ["studyType", "study_type", "degree"]),
            "startDate": _date(get_first(raw, ["startDate", "start_date", "from"])),
            "endDate": _date(get_first(raw, ["endDate", "end_date", "to", "graduationDate", "graduation_date"])),
            "score": get_first(raw, ["score", "gpa"]),
            "courses": [text_for(course, "text", "name") for course in as_list(raw.get("courses")) if text_for(course, "text", "name")],
        }
    )


def _skill_item(item: Any) -> JsonDict:
    raw = as_dict(item)
    keywords = raw.get("keywords")
    if keywords is None:
        keywords = raw.get("items") or raw.get("skills")
    return compact_dict(
        {
            "name": get_first(raw, ["name", "category"]),
            "level": get_first(raw, ["level"]),
            "keywords": [text_for(keyword, "text", "name") for keyword in as_list(keywords) if text_for(keyword, "text", "name")],
        }
    )


def _project_item(item: Any) -> JsonDict:
    raw = as_dict(item)
    return compact_dict(
        {
            "name": get_first(raw, ["name", "title"]),
            "description": get_first(raw, ["description", "summary"]),
            "highlights": _highlights(raw),
            "keywords": [text_for(keyword, "text", "name") for keyword in as_list(raw.get("keywords") or raw.get("technologies")) if text_for(keyword, "text", "name")],
            "startDate": _date(get_first(raw, ["startDate", "start_date", "from"])),
            "endDate": _date(get_first(raw, ["endDate", "end_date", "to"])),
            "url": get_first(raw, ["url", "link"]),
            "roles": [text_for(role, "text", "name") for role in as_list(raw.get("roles")) if text_for(role, "text", "name")],
            "entity": get_first(raw, ["entity", "organization"]),
            "type": get_first(raw, ["type"]),
        }
    )


def _certificate_item(item: Any) -> JsonDict:
    raw = as_dict(item)
    return compact_dict(
        {
            "name": get_first(raw, ["name", "title"]),
            "date": _date(get_first(raw, ["date", "issuedAt", "issued_at"])),
            "issuer": get_first(raw, ["issuer", "authority"]),
            "url": get_first(raw, ["url", "link"]),
        }
    )


def _award_item(item: Any) -> JsonDict:
    raw = as_dict(item)
    return compact_dict(
        {
            "title": get_first(raw, ["title", "name"]),
            "date": _date(get_first(raw, ["date"])),
            "awarder": get_first(raw, ["awarder", "issuer", "organization"]),
            "summary": get_first(raw, ["summary", "description"]),
        }
    )


def _language_item(item: Any) -> JsonDict:
    raw = as_dict(item)
    return compact_dict(
        {
            "language": get_first(raw, ["language", "name"]),
            "fluency": get_first(raw, ["fluency", "level"]),
        }
    )


def _interest_item(item: Any) -> JsonDict:
    raw = as_dict(item)
    return compact_dict(
        {
            "name": get_first(raw, ["name", "title"]),
            "keywords": [text_for(keyword, "text", "name") for keyword in as_list(raw.get("keywords")) if text_for(keyword, "text", "name")],
        }
    )


def career_profile_to_json_resume(profile: Mapping[str, Any]) -> JsonDict:
    """Convert a ResumePilot CareerProfile dictionary into JSON Resume.

    The function is deterministic and does not infer missing facts. Callers
    should run `FactValidator` before and after this conversion.
    """

    if not isinstance(profile, Mapping):
        raise TypeError("profile must be a mapping")

    resume = {
        "basics": _basics(profile),
        "work": [_work_item(item) for item in as_list(profile.get("work") or profile.get("experience"))],
        "education": [_education_item(item) for item in as_list(profile.get("education"))],
        "skills": [_skill_item(item) for item in as_list(profile.get("skills"))],
        "projects": [_project_item(item) for item in as_list(profile.get("projects"))],
        "certificates": [_certificate_item(item) for item in as_list(profile.get("certificates") or profile.get("certifications"))],
        "awards": [_award_item(item) for item in as_list(profile.get("awards"))],
        "languages": [_language_item(item) for item in as_list(profile.get("languages"))],
        "interests": [_interest_item(item) for item in as_list(profile.get("interests"))],
    }

    meta = as_dict(profile.get("meta") or profile.get("metadata"))
    resume["meta"] = compact_dict(
        {
            "canonical": get_first(meta, ["canonical"]),
            "version": get_first(meta, ["version"], "https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json"),
            "lastModified": get_first(meta, ["lastModified", "last_modified"]),
            "source": "ResumePilot",
            "targetRole": get_first(meta, ["targetRole", "target_role"]),
        }
    )

    return compact_dict(resume)


def write_resume_json(profile: Mapping[str, Any], output_path: str, *, indent: int = 2) -> JsonDict:
    """Convert CareerProfile and write the resulting JSON Resume to disk."""

    resume = career_profile_to_json_resume(profile)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(resume, ensure_ascii=False, indent=indent) + "\n", encoding="utf-8")
    return resume
