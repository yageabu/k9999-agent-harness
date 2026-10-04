# Skills

A skill is long-form knowledge that is advertised but not loaded. The system prompt carries its name and one-line description; the agent reads the file only when the task matches.

Use a skill when the content applies to a minority of sessions, or when it is long enough that carrying it in every request would crowd out the instructions that apply to all of them.

## Layout

```
skills/<name>/SKILL.md
```

A profile opts in by listing the name:

```json
{
	"name": "Code Agent",
	"tools": ["read", "bash", "edit"],
	"skills": ["linkbus-dev"]
}
```

The profile loader validates declared names: a name with no `SKILL.md` fails the load with the missing path, and a skill with no description fails with the file it read.

## Format

The description that reaches the system prompt is taken from, in order: frontmatter `description:`, a bare `description:` line, or the first paragraph that is not a heading. A skill with none of these fails the load.

```markdown
---
description: Use when changing deployment, environment variables, or release steps.
---

# Deploying the reporting service

## Build

...
```

## What belongs here

- Project conventions too specific to every task: build commands, release steps, coding standards
- Reference material: table schemas, metric definitions, API contracts
- Procedures the agent would otherwise rediscover each session

## What does not

- Behavioral rules. Those belong in `profiles/<id>/system.md`, because they apply to every response.
- Facts about the repository as a whole. Those belong in `AGENTS.md`.
- Anything the agent can read directly from the source in one tool call.

## Status

Declared skills are resolved from disk and rendered into the system prompt as an `## Skills` section. Reading a skill is the agent's own `read` call; there is no skill-invocation tool yet.
