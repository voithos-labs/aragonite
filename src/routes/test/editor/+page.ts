import type { PageLoad } from './$types';

// Resolve the plugin toggle in a universal load, not a `typeof window` guard in
// the component: server and client then read the same `?plugins`, so the harness
// SSRs and hydrates one identical document. Default off (no `?plugins=1`) is the
// load-bearing pin — this route is also the fixture for the e2e, simulation, and
// perf batteries, all of which assume plugin-free grammar, so the param-less path
// must stay byte-identical to a plugin-free editor.
export const load: PageLoad = ({ url }) => {
	return { plugins: url.searchParams.get('plugins') === '1' };
};
