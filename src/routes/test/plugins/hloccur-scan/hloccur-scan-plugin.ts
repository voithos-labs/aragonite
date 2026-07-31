// Harness observability wrapper over the bundled highlight-occurrences plugin. It
// CONFIGURES the shipped unit through its public `onScan` option rather than re-declaring
// the wiring, so the memoization battery pins the plugin consumers actually get.
import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';

declare global {
	interface Window {
		__hloccurScans?: number;
	}
}

// Each spec navigates to a fresh page, so the counter starts undefined and the
// readers' `?? 0` is the zero point — no module-scope window write on the SSR path.
export const hloccurScanProbePlugin = highlightOccurrencesPlugin({
	onScan: () => {
		window.__hloccurScans = (window.__hloccurScans ?? 0) + 1;
	}
});
