/**
 * Cumulative block-height model for one BlockList. A Fenwick (binary-indexed)
 * tree over the children array: O(log n) prefix-sum (pixel offset of an index),
 * offset->index lookup, and per-index update. Virtual rendering uses it to map
 * scrollTop to a window range without laying off-screen blocks out.
 */
export class HeightModel {
	private tree: number[]; // 1-indexed Fenwick sums
	private heights: number[]; // per-index current height, for O(1) read-back
	private count: number;

	constructor(initialHeights: number[]) {
		this.count = initialHeights.length;
		this.heights = initialHeights.slice();
		this.tree = new Array(this.count + 1).fill(0);
		for (let i = 0; i < this.count; i++) this.bump(i, initialHeights[i]);
	}

	get size(): number {
		return this.count;
	}

	/** Total pixel height of all entries. */
	total(): number {
		return this.prefix(this.count);
	}

	/** Pixel offset of the top of index `i` (sum of heights[0..i)); `offsetOf(count)` == total. */
	offsetOf(i: number): number {
		return this.prefix(i);
	}

	/** Current height stored for index `i`. */
	heightOf(i: number): number {
		return this.heights[i] ?? 0;
	}

	/** Set index `i` to `height` in O(log n). No-op when unchanged. */
	setHeight(i: number, height: number): void {
		const delta = height - this.heights[i];
		if (delta === 0) return;
		this.heights[i] = height;
		this.bump(i, delta);
	}

	/** Largest index whose top offset is <= `y` (the block visible at scroll y), clamped to [0, count-1]. */
	indexAtOffset(y: number): number {
		if (this.count === 0) return 0;
		let idx = 0;
		let remaining = y;
		let bit = 1 << Math.floor(Math.log2(this.count));
		while (bit > 0) {
			const next = idx + bit;
			if (next <= this.count && this.tree[next] <= remaining) {
				idx = next;
				remaining -= this.tree[next];
			}
			bit >>= 1;
		}
		return Math.min(idx, this.count - 1);
	}

	private bump(i: number, delta: number): void {
		for (let p = i + 1; p <= this.count; p += p & -p) this.tree[p] += delta;
	}

	private prefix(i: number): number {
		let s = 0;
		for (let p = i; p > 0; p -= p & -p) s += this.tree[p];
		return s;
	}
}
