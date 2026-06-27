---
name: "resume-generation-skill"
description: "Use when the platform needs to generate an ATS-friendly resume.json from an edited CareerProfile and confirmed multi-turn conversation context."
---

# Resume Generation Skill

## When to use
- User has edited a resume inside ResumePilot and wants a final generated resume.
- The platform has multi-turn AI conversation context that contains user-confirmed corrections or additions.
- The output should be a structured `resume.json` compatible with JSON Resume.

## Workflow
1. Normalize the edited resume and confirmed conversation facts into a CareerProfile.
2. Build an evidence store from the original resume text and user-confirmed conversation facts.
3. Validate that every CareerProfile field either comes from the uploaded resume or has explicit confirmation evidence.
4. Convert CareerProfile to JSON Resume with `career_profile_to_json_resume`.
5. Validate the generated JSON Resume again before writing `resume.json`.
6. If a target job description is available, run the adapted job-application-optimizer stage.
7. Return the generated artifact, validation report, and internal optimization report with unsupported facts blocked.

## Output principles
- ATS compatibility first: single-column friendly data, standard section names, no visual-only content.
- Preserve facts exactly for names, companies, titles, dates, schools, metrics, URLs, and project names.
- Do not invent metrics, seniority, employers, education, certifications, awards, or dates.
- Conversation context is usable only when the user explicitly confirmed it.
- If validation fails, block output and return unsupported facts instead of producing a polished but unsafe resume.
- Job optimization suggestions are recommendations only; every suggested resume change must be confirmed by the user before entering CareerProfile.

## Core files
- `src/resume_generation_skill/career_profile.py` - lightweight CareerProfile data helpers.
- `src/resume_generation_skill/json_resume.py` - independent CareerProfile to JSON Resume conversion.
- `src/resume_generation_skill/fact_validator.py` - evidence-backed fact validation.
- `src/resume_generation_skill/job_optimizer.py` - JD keyword, match, ATS, and tailoring recommendation logic adapted from job-application-optimizer.
- `src/resume_generation_skill/generator.py` - orchestration shell for platform integration.
