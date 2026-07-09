export function renderScanReport(inventory) {
  const lines = [
    `# vibe-access scan — ${inventory.app} — ${inventory.generatedAt.slice(0, 10)}`,
    '',
    `Adapter: **${inventory.adapter}** · Routes: **${inventory.routes.length}** · Unmapped: **${inventory.unmapped.length}**`,
    '',
    '## Routes',
    '',
    '| Method | Path | Auth | Source |',
    '|---|---|---|---|',
    ...inventory.routes.map((r) => `| ${r.method} | ${r.path} | ${r.auth} | ${r.sourceRef} |`),
    '',
    '## Unmapped',
    '',
    ...(inventory.unmapped.length
      ? inventory.unmapped.map((u) => `- \`${u.sourceRef}\` — ${u.reason}`)
      : ['Nothing unmapped.']),
    '',
  ];
  return lines.join('\n');
}

export function renderVerifyReport(run, manifest) {
  const counts = { pass: 0, fail: 0, 'pending-agent': 0, skipped: 0 };
  for (const r of run.results) counts[r.status] += 1;
  const lines = [
    `# vibe-access verify — ${manifest.app} — run ${run.runId}`,
    '',
    `Base URL: ${run.baseUrl} · pass ${counts.pass} · fail ${counts.fail} · pending-agent ${counts['pending-agent']} · skipped ${counts.skipped}`,
    '',
    '| Affordance | Status | HTTP | Detail |',
    '|---|---|---|---|',
    ...run.results.map(
      (r) => `| ${r.affordanceId} | ${r.status} | ${r.httpStatus ?? '—'} | ${r.detail ?? ''} |`
    ),
    '',
  ];
  return lines.join('\n');
}
