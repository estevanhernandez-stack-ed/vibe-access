// Sidecar routes carry no user auth — the dev gate (env flag + loopback
// bind) is the protection, and it's recorded via tier=dev plus
// gateMechanism, not an auth class. UI modes never reach detectAuth: they
// land in `unmapped`, not `routes`, so the host app's login gate (session
// cookies wrapping the Streamlit dispatch) is out of frame here.
export function detectAuth() {
  return 'none';
}
