/**
 * The frame probe the caret-frame rows share: every frame, just before it paints, it compares the
 * drawn caret's bar with the live range's box. A frame lags when both exist and they sit more than
 * a pixel apart, which is a caret the user saw a frame behind the letter.
 */

import type { Page } from '@playwright/test';
import { percentileMs } from './latency-harness';

/** One run of moves, summarized. */
export interface CaretFrameSummary {
	frames: number;
	/** Frames where the bar and the range both existed. */
	compared: number;
	/** Of those, frames where the bar sat more than a pixel from the range in x or y. */
	lagging: number;
	/** The largest difference in x, y or height over every compared frame. */
	maxDeltaPx: number;
	caretPaintP50Ms: number | null;
	caretPaintP95Ms: number | null;
	/** Event Timing's `keydown` to next paint, over the entries it reported (16ms and up). */
	keydownToPaintP50Ms: number | null;
	keydownEntries: number;
}

/** Samples from a size observer, which fires after every frame callback (the editor's own paint
 *  included); a hidden element resized each frame keeps it firing every frame. */
export async function installCaretFrameProbe(page: Page): Promise<void> {
	await page.evaluate(() => {
		const probe = { frames: 0, compared: 0, lagging: 0, maxDelta: 0, keydowns: [] as number[] };
		const rangeBox = () => {
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
			const range = sel.getRangeAt(0);
			const rects = range.getClientRects();
			const own =
				rects.length > 0 && rects[0].height > 0 ? rects[0] : range.getBoundingClientRect();
			return own.height > 0 ? own : null;
		};
		const sample = () => {
			probe.frames++;
			const bar = document.querySelector<HTMLElement>('.md-drawn-caret[data-caret-state="text"]');
			const native = rangeBox();
			if (!bar || !native) return;
			const drawn = bar.getBoundingClientRect();
			const dx = Math.abs(drawn.left - native.left);
			const dy = Math.abs(drawn.top - native.top);
			const dh = Math.abs(drawn.height - native.height);
			probe.compared++;
			if (dx > 1 || dy > 1) probe.lagging++;
			probe.maxDelta = Math.max(probe.maxDelta, dx, dy, dh);
		};
		const ticker = document.createElement('div');
		ticker.style.cssText = 'position:fixed;left:-10px;top:0;height:1px;width:1px;';
		document.body.appendChild(ticker);
		new ResizeObserver(sample).observe(ticker);
		let wide = false;
		const loop = () => {
			wide = !wide;
			ticker.style.width = wide ? '2px' : '1px';
			requestAnimationFrame(loop);
		};
		requestAnimationFrame(loop);
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (entry.name === 'keydown') probe.keydowns.push(entry.duration);
			}
		}).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
		(window as any).__caretFrameProbe = probe;
		(window as any).__test.perf.enable();
	});
}

/** Starts a run: the probe's counts and the paint instrument go back to zero. */
export async function resetCaretFrameProbe(page: Page): Promise<void> {
	await page.evaluate(() => {
		const p = (window as any).__caretFrameProbe;
		Object.assign(p, { frames: 0, compared: 0, lagging: 0, maxDelta: 0, keydowns: [] });
		(window as any).__test.perf.reset();
	});
}

/** The run so far, after two more frames so the last move's frame is counted. */
export async function readCaretFrameProbe(page: Page): Promise<CaretFrameSummary> {
	await page.evaluate(
		() =>
			new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
	);
	const raw = await page.evaluate(() => {
		const p = (window as any).__caretFrameProbe;
		const paints = ((window as any).__test.perf.snapshot().caretPaintMs ?? []) as number[];
		return { ...p, keydowns: [...p.keydowns], paints };
	});
	const p50 = (xs: number[]) => (xs.length ? percentileMs(xs, 50) : null);
	return {
		frames: raw.frames,
		compared: raw.compared,
		lagging: raw.lagging,
		maxDeltaPx: raw.maxDelta,
		caretPaintP50Ms: p50(raw.paints),
		caretPaintP95Ms: raw.paints.length ? percentileMs(raw.paints, 95) : null,
		keydownToPaintP50Ms: p50(raw.keydowns),
		keydownEntries: raw.keydowns.length
	};
}
