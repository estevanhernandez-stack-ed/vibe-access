const NEEDS = [
  {
    need: 'seed',
    satisfiedBy: (m) => m.affordances.some((a) => a.kind === 'seed'),
    candidate: { id: 'agent-seed', kind: 'seed', description: 'Seed representative data for agent-driven testing.' },
  },
  {
    need: 'reset',
    satisfiedBy: (m) => m.affordances.some((a) => a.kind === 'reset'),
    candidate: { id: 'agent-reset', kind: 'reset', description: 'Reset app state to a known baseline.' },
  },
  {
    need: 'read-state',
    satisfiedBy: (m) => m.affordances.some((a) => a.kind === 'read'),
    candidate: { id: 'agent-state', kind: 'read-state', description: 'Read app state relevant to verification.' },
  },
  {
    need: 'capture',
    satisfiedBy: (m) => m.affordances.some((a) => a.kind === 'capture'),
    candidate: { id: 'agent-capture', kind: 'capture', description: 'Prepare a named screenshot-ready view state.' },
  },
  {
    need: 'act-as-user',
    satisfiedBy: (m) => m.affordances.some((a) => a.kind === 'act'),
    candidate: { id: 'agent-act', kind: 'act', description: 'Act through a real user flow within caller auth.' },
  },
  {
    need: 'discovery',
    satisfiedBy: (m) => typeof m.discoveryRoute === 'string' && m.discoveryRoute.length > 0,
    candidate: { id: 'agent-manifest', kind: 'discovery', description: 'Serve the agent-access manifest at a dev-only route.' },
  },
];

export function evaluateGaps(manifest) {
  const met = [];
  const gaps = [];
  for (const n of NEEDS) {
    if (n.satisfiedBy(manifest)) {
      met.push(n.need);
    } else {
      gaps.push({ need: n.need, ...n.candidate });
    }
  }
  return { met, gaps };
}
