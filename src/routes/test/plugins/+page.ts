import type { PageLoad } from './$types';

// A universal load, not a `typeof window` guard in the component: server and client then
// read the same `?seed` and hydrate one identical document. `?scroll=host` hands the scroll to
// the harness box around the editor.
export const load: PageLoad = ({ url }) => {
	return {
		seed: url.searchParams.get('seed'),
		scrollMode: url.searchParams.get('scroll') === 'host' ? ('host' as const) : ('self' as const)
	};
};
