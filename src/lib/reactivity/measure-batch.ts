/**
 * Read-all-then-write height measurement: a rect read right after a layout-dirtying height
 * write forces a synchronous reflow PER block, so the pass splits into a pure read phase
 * and a pure write phase and costs at most one reflow. Kept free of DOM and reactive state
 * so the ordering is unit-testable with spies.
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
