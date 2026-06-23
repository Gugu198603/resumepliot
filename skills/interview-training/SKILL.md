---
name: "interview-training"
description: "Use when the user wants mock interview, follow-up questions, answer critique, or pressure questions grounded in resume/project text."
---

# Interview Training Skill

## When to use
- User asks for mock interview
- User asks for follow-up questions
- User wants answer critique
- User wants pressure questions based on resume/project text

## Workflow
1. Parse the input resume or project text into structured sections.
2. Run the planner to decide the current stage and next specialist agent.
3. Use retrieval to fetch the most relevant chunks for the current goal.
4. Generate questions in three buckets:
   - basic
   - detail
   - pressure
5. Ask one question at a time or return a grouped question set.
6. Critique the user's answer for specificity, technical depth, and credibility.
7. If needed, rewrite the answer into a stronger interview-ready version.

## Output principles
- Questions must be grounded in retrieved text, not invented facts.
- Critique should focus on action, detail, and verifiability.
- Avoid binding output to any specific person unless the input explicitly contains that identity.
