---
name: evolve-access
description: This skill should be used when the user says "/vibe-access:evolve-access" and wants vibe-access to propose improvements to itself from session/friction history. v0.1 placeholder — paths fixed, no implementation.
---

# evolve-access (v0.1 placeholder)

Reads (when implemented): `~/.claude/plugins/data/vibe-access/{sessions,friction}.jsonl`
plus `adapter-notes/*.md` — adapter notes with repeated stacks are the highest-value
signal (each is a part-built adapter). Writes `docs/proposed-changes.md` in the
vibe-access solo repo. Never auto-applies. Scoring: count x confidence weight
{high: 3, medium: 2, low: 1}.
