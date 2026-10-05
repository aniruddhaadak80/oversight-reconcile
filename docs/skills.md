# Skills

A skill is markdown instructions for an agent, shipped into the user's agent directory.

## Layout

```
skills/
  ATTRIBUTION.md          provenance for anything adapted from elsewhere
  AGENTS.md               the authoring standard
  <skill-name>/
    SKILL.md
```

## What ships here

| Skill                    | Use it when                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `product-overview`       | you need the map of the product before changing anything     |
| `reconcile-oversight`    | a governance document must be checked against a register     |
| `author-obligation-pack` | a framework needs to become machine-checkable                |
| `diagnose`               | something is broken and the failing subsystem is not obvious |

## Frontmatter contract

```yaml
---
name: kebab-case-unique # required
description: One sentence, saying WHEN to use it.
metadata:
  version: 1.0.0 # required, semver - bump on ANY body change
  upstream: optional-name # required if adapted from another project
  upstreamUrl: https://... # required if adapted from another project
---
```

## Why the version gate

These files ship into users' agent directories. A body change without a version bump is an update
that is never offered. So `npm run check:skill-version` fails the build when a `SKILL.md` body
changes and `metadata.version` does not.

## Validation

```bash
node packages/cli/dist/bin.js mcp call list_skills '{"includeBodies":false}'
```

reports every issue with a file and a line:

- missing or unparseable frontmatter
- a `name` that is not kebab-case, or that collides with another skill
- a `description` that is missing or too short to be useful
- a `metadata.version` that is absent or not semver

Invalid skills are **reported, never silently skipped**. A skill that fails to load is a product
bug the user needs to see, and `doctor` fails on it.

## Naming real commands

The authoring standard requires each step to name a command that exists, and this repo holds to
it. Every command in every shipped skill was run before the skill was committed — which is why
there is no `oversight-reconcile skills` command and the skills doc tells you to use
`mcp call list_skills` instead.
