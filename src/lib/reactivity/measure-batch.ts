/**
 * Read every height, then write every height: a rect read right after a height write that
 * dirties layout forces one synchronous reflow per block, so the pass splits into a read phase
 * and a write phase and costs at most one reflow. Kept free of DOM and reactive state so the
 * ordering can be unit-tested with spies.
 */

export interface MeasureEntry {
	/** Read this entry's DOM height (a layout read). */
	readHeight: () => number;
	/** Write the measured height into the height table (a write that dirties layout). */
	applyHeight: (height: number) => void;
}

/** Read every entry's height, then apply every write. A height of 0 or less (not laid out,
 *  or jsdom) is skipped on write; the read still happens, so the two phases stay separate. */
export function runMeasureBatch(entries: Iterable<MeasureEntry>): void {
	const measured: { applyHeight: (height: number) => void; height: number }[] = [];
	for (const entry of entries) {
		const height = entry.readHeight();
		if (height > 0) measured.push({ applyHeight: entry.applyHeight, height });
	}
	for (const { applyHeight, height } of measured) applyHeight(height);
}
