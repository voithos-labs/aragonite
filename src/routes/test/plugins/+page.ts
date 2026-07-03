// The plugins harness drives the CST contenteditable editor — a client-only
// surface. Under SSR, a container whose chrome adds a real focusable element
// (the `<details>` toggle) beside its BlockList perturbs the hydration walk of
// the contenteditable subtree and the block errors into its render boundary; the
// sole-child pseudo-element trick the callout uses only sidesteps the symptom.
// The editor renders identically client-side, so disable SSR for the harness.
export const ssr = false;
