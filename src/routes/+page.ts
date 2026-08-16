// Prerendered so the deployed demo paints its chrome before the bundle boots. Scoped per route,
// never app-wide: the `/test/*` harnesses read `url.searchParams` in a universal load, which a
// build-time render cannot answer.
export const prerender = true;
