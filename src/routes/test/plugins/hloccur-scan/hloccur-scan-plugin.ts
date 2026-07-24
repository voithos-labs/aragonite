// Harness observability wrapper over the bundled highlight-occurrences memo. It
// installs the SAME createOccurrenceSource the plugin ships, adding an onScan hook
// that publishes the index-rebuild count to window — so the memoization e2e can
// assert a caret move re-filters the cached index without re-scanning. The bundled
// plugin stays clean (doc-stats precedent: the harness owns the window channel).
import { definePlugin } from '$lib/plugin';
import { createOccurrenceSource } from '$lib/plugins/highlight-occurrences/occurrence-source';

declare global {
	interface Window {
		__hloccurScans?: number;
	}
}

export const hloccurScanProbePlugin = definePlugin({
	name: 'hloccur-scan-probe',
	setup(ctx) {
		ctx.onEditor((editor) => {
			window.__hloccurScans = 0;
			const occurrences = createOccurrenceSource({
				onScan: () => {
					window.__hloccurScans = (window.__hloccurScans ?? 0) + 1;
				}
			});
			const handle = editor.decorations.addSource(occurrences.source);
			const off = editor.events.on('selectionChange', (selection) => {
				occurrences.setSelection(selection);
				handle.invalidate();
			});
			return () => {
				off();
				handle.dispose();
			};
		});
	}
});
