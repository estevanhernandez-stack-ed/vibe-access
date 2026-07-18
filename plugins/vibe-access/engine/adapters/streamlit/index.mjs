import { detectRoutes } from './routes.mjs';
import { detectAuth } from './auth.mjs';
import { scaffoldAffordance } from './scaffold.mjs';

export const streamlitAdapter = {
  id: 'streamlit',
  matches: (detection) => detection?.framework === 'streamlit',
  detectRoutes,
  detectAuth,
  scaffoldAffordance,
  gateMechanism: () => ({
    kind: 'env-flag+loopback',
    description:
      'Sidecar refuses to boot without VIBE_ACCESS_DEV=1 and binds 127.0.0.1 only. Marker: vibe-access:dev-gate in every scaffolded file.',
  }),
};
