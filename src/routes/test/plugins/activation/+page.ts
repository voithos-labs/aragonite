import type { PageLoad } from './$types';

// A universal load, so server and client read the same variant and hydrate one document.
export const load: PageLoad = ({ url }) => {
	return { reads: url.searchParams.has('reads') };
};
