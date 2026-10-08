/**
 * Read every height, then write every height: a rect read right after a height write that
 * dirties layout forces one synchronous reflow per block, so the pass splits into a read phase
 * and a write phase and costs at most one reflow. Kept free of DOM and reactive state so the
 * ordering can be unit-tested with spies.
 */

export interface MeasureEntry {
	readHeight: () => number;
	/** Writes the measured height into the height table, which can dirty layout. */
	applyHeight: (height: number) => void;
}

/** A height of 0 or less (not laid out, or under jsdom) is never written. */
export function runMeasureBatch(entries: Iterable<MeasureEntry>): void {
	const measured: { applyHeight: (height: number) => void; height: number }[] = [];
	for (const entry of entries) {
		const height = entry.readHeight();
		if (height > 0) measured.push({ applyHeight: entry.applyHeight, height });
	}
	for (const { applyHeight, height } of measured) applyHeight(height);
}
