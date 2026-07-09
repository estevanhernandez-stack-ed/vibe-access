import { detectRoutes } from './routes.mjs';

export const firebaseFunctionsAdapter = {
  id: 'firebase-functions',
  matches: (detection) => detection?.framework === 'firebase-functions',
  detectRoutes,
  detectAuth: () => 'none', // replaced in Task 6
  scaffoldAffordance: () => {
    throw new Error('scaffoldAffordance lands in Task 10');
  },
  gateMechanism: () => ({
    kind: 'env',
    description:
      'Dev-tier functions 404 unless FUNCTIONS_EMULATOR === "true" or AGENT_ACCESS === "dev". Marker: vibe-access:dev-gate.',
  }),
};
