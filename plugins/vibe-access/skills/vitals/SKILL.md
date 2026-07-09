---
name: vitals
description: This skill should be used when the user says "/vibe-access:vitals", "is vibe-access healthy", "self-test the plugin". Read-only structural self-check of the plugin installation itself (not the target app). Banner report with ✓/⚠/✗ per check.
---

# vibe-access vitals

Run these eight checks against the plugin's own install directory; render one line
each with ✓ (pass), ⚠ (degraded), ✗ (fail), then a summary line `N ✓ · N ⚠ · N ✗`:

1. `.claude-plugin/plugin.json` parses; name is vibe-access.
2. All 11 skills present under skills/ with name+description frontmatter.
3. All 6 command stubs present under commands/.
4. Engine modules present: cli, detect, scan, map, gaps, scaffold, verify, backup,
   schema, report (+ adapters/index).
5. CLI answers: `node engine/cli.mjs detect --app .` exits 0.
6. firebase-functions adapter present with both templates; templates contain the
   vibe-access:dev-gate marker.
7. All 4 schemas parse as JSON.
8. Test suite green: `npm test` exits 0.
