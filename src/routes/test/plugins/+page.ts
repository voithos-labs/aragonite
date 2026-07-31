import type { PageLoad } from './$types';

// A universal load, not a `typeof window` guard in the component: server and client then
// read the same `?seed` and hydrate one identical document.
export const load: PageLoad = ({ url }) => {
	return { seed: url.searchParams.get('seed') };
};
