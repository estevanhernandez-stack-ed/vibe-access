import { detectRoutes } from './routes.mjs';
import { detectAuth } from './auth.mjs';
import { scaffoldAffordance } from './scaffold.mjs';

export const firebaseFunctionsAdapter = {
  id: 'firebase-functions',
  matches: (detection) => detection?.framework === 'firebase-functions',
  detectRoutes,
  detectAuth,
  scaffoldAffordance,
  gateMechanism: () => ({
    kind: 'env',
    description:
      'Dev-tier functions 404 unless FUNCTIONS_EMULATOR === "true" or AGENT_ACCESS === "dev". Marker: vibe-access:dev-gate.',
  }),
};
