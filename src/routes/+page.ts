// Prerendered so the deployed demo paints its header before the bundle loads. Set per route,
// never app-wide: the `/test/*` harnesses read `url.searchParams` in a universal load, which a
// build-time render cannot answer.
export const prerender = true;
