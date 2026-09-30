// A harness wrapper that counts what the bundled highlight-occurrences plugin does. It
// configures the shipped plugin through its public `onScan` option rather than rebuilding it,
// so the memoization suite tests the plugin consumers actually get.
import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';

declare global {
	interface Window {
		__hloccurScans?: number;
		__hloccurTokenized?: number;
	}
}

// Each spec loads a fresh page, so the counters start undefined and the `?? 0` where they are
// read is the zero point: nothing writes to `window` at module scope, which SSR would run.
export const hloccurScanProbePlugin = highlightOccurrencesPlugin({
	onScan: ({ tokenizedLeaves }) => {
		window.__hloccurScans = (window.__hloccurScans ?? 0) + 1;
		window.__hloccurTokenized = (window.__hloccurTokenized ?? 0) + tokenizedLeaves;
	}
});
