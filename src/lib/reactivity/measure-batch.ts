/**
 * Read-all-then-write height measurement. Each newly-mounted (or edited) block
 * needs its real post-layout height recorded into the scope's model. Reading one
 * block's `getBoundingClientRect` right after writing the previous block's height
 * (which dirties layout) forces a synchronous reflow PER block — the thrash a perf
 * feature must not introduce (one forced reflow per mounted block on a fling). This
 * splits the pass into a pure read phase and a pure write phase: no read ever
 * follows a write, so the whole batch costs at most one reflow.
 *
 * Pure (no DOM, no reactive state) so the read-before-write ordering is unit-testable
 * with spies — the honest guard against a regression silently re-interleaving them.
 */

export interface MeasureEntry {
	/** Read this entry's DOM height (a layout read). */
	readHeight: () => number;
	/** Write the measured height into the model (a layout-dirtying write). */
	applyHeight: (height: number) => void;
}

/** Read every entry's height, THEN apply every write. Heights <= 0 (unlaid-out /
 *  jsdom) are skipped on write — the read still happens so the phase split holds. */
export function runMeasureBatch(entries: Iterable<MeasureEntry>): void {
	const measured: { applyHeight: (height: number) => void; height: number }[] = [];
	for (const entry of entries) {
		const height = entry.readHeight();
		if (height > 0) measured.push({ applyHeight: entry.applyHeight, height });
	}
	for (const { applyHeight, height } of measured) applyHeight(height);
}
