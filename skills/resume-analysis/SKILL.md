---
name: "resume-analysis"
description: "Use when the user wants structured resume parsing, risk-term scanning, section extraction, or readiness analysis."
---

# Resume Analysis Skill

## When to use
- User uploads or pastes a resume
- User asks what is risky or hard to defend in the resume
- User wants structured extraction of sections
- User wants preparation advice before interview

## Workflow
1. Normalize and parse the resume text.
2. Extract sections such as education, skills, experience, projects, and awards.
3. Detect high-risk technical terms that are likely to trigger deep follow-up questions.
4. Build a retrieval-ready knowledge base from the resume text.
5. Return structured analysis and optionally hand off to interview-training or resume-rewrite.

## Output principles
- Keep the analysis factual and grounded in the provided text.
- Flag terms that imply deep technical ownership.
- Separate parsing results from rewrite suggestions.
