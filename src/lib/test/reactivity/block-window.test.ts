import { describe, it, expect } from 'vitest';
import { computeWindow } from '../../reactivity/block-window.svelte';
import { HeightModel } from '../../cursor/height-model';

// 100 blocks, 50px each => total 5000px.
const model = () => new HeightModel(new Array(100).fill(50));
const base = {
	scrollTop: 0,
	viewportHeight: 500, // 10 blocks visible
	overscan: 2,
	pinnedIndex: null as number | null,
	pinExtensionCap: 100,
	windowingEnabled: true,
	active: true,
	activateAbovePx: 1000, // hysteresis watermarks
	deactivateBelowPx: 800
};

describe('computeWindow', () => {
	it('returns a viewport-plus-overscan slice and matching spacers', () => {
		const w = computeWindow(model(), { ...base, scrollTop: 1000 }); // top block = 20
		expect(w.active).toBe(true);
		expect(w.start).toBe(18); // 20 - overscan 2
		expect(w.end).toBe(32); // 20 + 10 visible + 2 overscan
		expect(w.topSpacerPx).toBe(18 * 50);
		expect(w.bottomSpacerPx).toBe((100 - 32) * 50);
	});

	it('clamps the window at the top and bottom of the document', () => {
		const top = computeWindow(model(), { ...base, scrollTop: 0 });
		expect(top.start).toBe(0);
		expect(top.topSpacerPx).toBe(0);

		const bottom = computeWindow(model(), { ...base, scrollTop: 4500 });
		expect(bottom.end).toBe(100);
		expect(bottom.bottomSpacerPx).toBe(0);
	});

	it('extends the contiguous range to include a near off-window pinned index', () => {
		// scrollTop 1000 -> base window start 18, end 32.
		const below = computeWindow(model(), { ...base, scrollTop: 1000, pinnedIndex: 15 });
		expect(below.start).toBe(15); // 3 above start, within cap -> extended
		expect(below.end).toBe(32);

		const above = computeWindow(model(), { ...base, scrollTop: 0, pinnedIndex: 20 });
		// scrollTop 0 -> window start 0, end 12; pin 20 is below end, 9 within cap.
		expect(above.start).toBe(0);
		expect(above.end).toBe(21);
	});

	it('does not extend the range for a pinned index beyond the cap', () => {
		const below = computeWindow(model(), {
			...base,
			scrollTop: 2000,
			pinnedIndex: 0,
			pinExtensionCap: 10
		});
		// scrollTop 2000 -> start 38; pin 0 is 38 above, beyond cap 10 -> no extension.
		expect(below.start).toBe(38);

		const above = computeWindow(model(), {
			...base,
			scrollTop: 0,
			pinnedIndex: 20,
			pinExtensionCap: 5
		});
		// pin 20 is 9 below end 12, beyond cap 5 -> no extension.
		expect(above.end).toBe(12);
	});

	it('does not change the range when the pinned index is already inside the window', () => {
		const w = computeWindow(model(), { ...base, scrollTop: 0, pinnedIndex: 5 });
		expect(w.start).toBe(0);
		expect(w.end).toBe(12);
	});

	it('deactivates when content height drops below the low watermark', () => {
		const small = new HeightModel(new Array(10).fill(50)); // 500px total < 800
		const w = computeWindow(small, { ...base, active: true });
		expect(w.active).toBe(false);
	});

	it('does not reactivate until content exceeds the high watermark (hysteresis)', () => {
		const mid = new HeightModel(new Array(18).fill(50)); // 900px: between 800 and 1000
		expect(computeWindow(mid, { ...base, active: false }).active).toBe(false);
		expect(computeWindow(mid, { ...base, active: true }).active).toBe(true);
	});

	// Host-scroll mode: no scrollport, so no viewport to window against. The gate
	// outranks the watermark AND the hysteresis latch, and the result is the same
	// mount-everything shape a document under the watermark produces.
	it('never activates while windowing is disabled', () => {
		const tall = model(); // 5000px total, far above the high watermark
		for (const active of [false, true]) {
			const w = computeWindow(tall, { ...base, active, windowingEnabled: false });
			expect(w.active).toBe(false);
			expect(w.start).toBe(0);
			expect(w.end).toBe(tall.size);
			expect(w.topSpacerPx).toBe(0);
			expect(w.bottomSpacerPx).toBe(0);
		}
	});

	// Guards the under-mount direction of the half-open boundary: a block whose
	// range straddles the bottom edge must stay mounted (no visible gap). The
	// aligned-scrollTop cases above can't catch a regression here.
	it('mounts a block straddling the half-open bottom edge', () => {
		// viewport [1010, 1510); block 30 = [1500, 1550) is partially visible.
		const w = computeWindow(model(), { ...base, scrollTop: 1010 });
		expect(w.start).toBeLessThanOrEqual(30);
		expect(w.end).toBeGreaterThan(30);
	});
});
