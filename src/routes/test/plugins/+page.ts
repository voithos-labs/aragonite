import type { PageLoad } from './$types';

// Resolve the seed in a universal load, not a `typeof window` guard in the
// component: the server and client then read the same `?seed`, so the harness
// SSRs and hydrates one identical document instead of diverging into a
// hydration mismatch.
export const load: PageLoad = ({ url }) => {
	return { seed: url.searchParams.get('seed') };
};
