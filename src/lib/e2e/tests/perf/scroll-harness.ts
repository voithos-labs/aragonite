/**
 * The wheel-tick measurement the scroll-hitch rows share: an in-page probe that counts what a
 * tick does to the editor (hosts mounted and unmounted, programmatic scrollTop writes, long
 * tasks, the worst rAF gap), a pass driver over real wheel ticks, a CPU-profile self-time
 * table, and the per-pass summary. One definition, so a row can only differ in its document.
 */

import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { percentileMs } from './latency-harness';

// ── The in-page probe ───────────────────────────────────────────────────────

export interface TickSample {
	added: number;
	removed: number;
	scrollWrites: number;
	writes: Array<{ from: number; to: number }>;
	addedKinds: Record<string, number>;
	longTasks: number[];
	maxFrameGap: number;
	scrolled: number;
	settleMs: number;
	mounted: number;
	renderCount: number;
	renderMs: number;
}

/** Counts what a tick does to the editor: block hosts mounted and unmounted, programmatic
 *  scrollTop writes (the correction), long tasks, and the worst rAF gap. */
export async function installProbe(page: Page): Promise<void> {
	await page.evaluate(() => {
		const editor = document.querySelector('.editor') as HTMLElement;
		const probe = {
			added: 0,
			removed: 0,
			scrollWrites: 0,
			writes: [] as Array<{ from: number; to: number }>,
			addedKinds: {} as Record<string, number>,
			longTasks: [] as number[],
			frameGaps: [] as number[]
		};
		const hostsOf = (n: Node): Element[] => {
			if (n.nodeType !== 1) return [];
			const el = n as Element;
			const own = el.matches('[data-block-path]') ? [el] : [];
			return own.concat(Array.from(el.querySelectorAll('[data-block-path]')));
		};
		new MutationObserver((records) => {
			for (const r of records) {
				for (const n of r.addedNodes) {
					for (const host of hostsOf(n)) {
						probe.added++;
						const kind = host.getAttribute('data-block-kind') ?? '?';
						probe.addedKinds[kind] = (probe.addedKinds[kind] ?? 0) + 1;
					}
				}
				for (const n of r.removedNodes) probe.removed += hostsOf(n).length;
			}
		}).observe(editor, { childList: true, subtree: true });
		const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
		Object.defineProperty(editor, 'scrollTop', {
			get() {
				return desc.get!.call(this);
			},
			set(v: number) {
				probe.scrollWrites++;
				probe.writes.push({ from: Math.round(desc.get!.call(this)), to: Math.round(v) });
				desc.set!.call(this, v);
			},
			configurable: true
		});
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) probe.longTasks.push(e.duration);
		}).observe({ type: 'longtask' });
		let last = performance.now();
		const loop = (t: number) => {
			probe.frameGaps.push(t - last);
			last = t;
			requestAnimationFrame(loop);
		};
		requestAnimationFrame(loop);
		(window as any).__scrollProbe = probe;
		// The demo route carries no bridge; its rows report the DOM census only.
		(window as any).__test?.perf.enable();
		(window as any).__test?.perf.reset();
	});
}

async function drainProbe(page: Page): Promise<Omit<TickSample, 'scrolled' | 'settleMs'>> {
	return page.evaluate(() => {
		const p = (window as any).__scrollProbe;
		const perf = (window as any).__test?.perf.snapshot();
		const out = {
			added: p.added,
			removed: p.removed,
			scrollWrites: p.scrollWrites,
			writes: p.writes.slice() as Array<{ from: number; to: number }>,
			addedKinds: { ...p.addedKinds } as Record<string, number>,
			longTasks: p.longTasks.slice() as number[],
			maxFrameGap: p.frameGaps.length ? Math.max(...p.frameGaps) : 0,
			mounted: document.querySelectorAll('[data-block-path]').length,
			renderCount: (perf?.blockRenderCount ?? 0) as number,
			renderMs: (perf?.blockRenderMsTotal ?? 0) as number
		};
		p.added = 0;
		p.removed = 0;
		p.scrollWrites = 0;
		p.writes.length = 0;
		p.addedKinds = {};
		p.longTasks.length = 0;
		p.frameGaps.length = 0;
		(window as any).__test?.perf.reset();
		return out;
	});
}

function editorScrollTop(page: Page): Promise<number> {
	return page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop);
}

/** The scroll has stopped moving for two frames: a smooth wheel scroll animates over several. */
async function settleScroll(page: Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				const el = document.querySelector('.editor') as HTMLElement;
				let last = el.scrollTop;
				let still = 0;
				const step = () => {
					if (el.scrollTop === last) still++;
					else still = 0;
					last = el.scrollTop;
					if (still >= 2) resolve();
					else requestAnimationFrame(step);
				};
				requestAnimationFrame(step);
			})
	);
}

export interface Pass {
	name: string;
	ticks: number;
	px: number;
}

export async function runPass(page: Page, editor: EditorPage, pass: Pass): Promise<TickSample[]> {
	const box = (await editor.editorContainer.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await editor.waitForRenderFlush();
	await drainProbe(page);
	const samples: TickSample[] = [];
	for (let i = 0; i < pass.ticks; i++) {
		const before = await editorScrollTop(page);
		const start = performance.now();
		await page.mouse.wheel(0, pass.px);
		await settleScroll(page);
		const settleMs = performance.now() - start;
		const scrolled = (await editorScrollTop(page)) - before;
		samples.push({ ...(await drainProbe(page)), scrolled, settleMs });
	}
	return samples;
}

// ── The CPU profile ─────────────────────────────────────────────────────────

interface ProfileNode {
	id: number;
	callFrame: { functionName: string; url: string; lineNumber: number };
}
export interface Profile {
	nodes: ProfileNode[];
	samples: number[];
	timeDeltas: number[];
}

/** Self time by function over the scroll, so a hitch names its owner. Readable on the dev
 *  server only: the production bundle mangles the names. */
export function topSelfTime(profile: Profile, n: number): Array<{ fn: string; ms: number }> {
	const byNode = new Map<number, number>();
	for (let i = 0; i < profile.samples.length; i++) {
		byNode.set(profile.samples[i], (byNode.get(profile.samples[i]) ?? 0) + profile.timeDeltas[i]);
	}
	const byFn = new Map<string, number>();
	for (const node of profile.nodes) {
		const us = byNode.get(node.id) ?? 0;
		if (!us) continue;
		const file = node.callFrame.url.split('/').pop()?.split('?')[0] ?? '';
		const key = `${node.callFrame.functionName || '(anonymous)'} ${file}:${node.callFrame.lineNumber}`;
		byFn.set(key, (byFn.get(key) ?? 0) + us / 1000);
	}
	return [...byFn.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, n)
		.map(([fn, ms]) => ({ fn, ms: Math.round(ms * 10) / 10 }));
}

// ── The row summary ─────────────────────────────────────────────────────────

export function summarize(samples: TickSample[]) {
	const sum = (f: (s: TickSample) => number) => samples.reduce((a, s) => a + f(s), 0);
	const max = (f: (s: TickSample) => number) => Math.max(...samples.map(f));
	const longTasks = samples.flatMap((s) => s.longTasks);
	const round = (x: number) => Math.round(x * 10) / 10;
	return {
		ticks: samples.length,
		hostsAdded: sum((s) => s.added),
		hostsRemoved: sum((s) => s.removed),
		maxAddedPerTick: max((s) => s.added),
		maxRemovedPerTick: max((s) => s.removed),
		ticksWithChurn: samples.filter((s) => s.added > 0 && s.removed > 0).length,
		mountedPeak: max((s) => s.mounted),
		mountedAtEnd: samples[samples.length - 1]?.mounted ?? 0,
		scrollWrites: sum((s) => s.scrollWrites),
		longTasks: longTasks.length,
		longTaskMaxMs: round(longTasks.length ? Math.max(...longTasks) : 0),
		longTaskTotalMs: round(longTasks.reduce((a, b) => a + b, 0)),
		frameGapP50Ms: round(
			percentileMs(
				samples.map((s) => s.maxFrameGap),
				50
			)
		),
		frameGapP95Ms: round(
			percentileMs(
				samples.map((s) => s.maxFrameGap),
				95
			)
		),
		frameGapMaxMs: round(max((s) => s.maxFrameGap)),
		settleP50Ms: round(
			percentileMs(
				samples.map((s) => s.settleMs),
				50
			)
		),
		settleP95Ms: round(
			percentileMs(
				samples.map((s) => s.settleMs),
				95
			)
		),
		scrolledMin: round(Math.min(...samples.map((s) => s.scrolled))),
		scrolledMax: round(max((s) => s.scrolled)),
		renderCount: sum((s) => s.renderCount),
		renderMs: round(sum((s) => s.renderMs)),
		// Every tick that wrote the scroll, with what it mounted: the attribution of a jump.
		writeTicks: samples
			.map((s, i) => ({ i, scrolled: s.scrolled, writes: s.writes, addedKinds: s.addedKinds }))
			.filter((t) => t.writes.length > 0)
	};
}
