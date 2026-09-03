import { type Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { capturePageErrors, waitForEditorHydrated } from '../../page-probes';
import { SHOWCASE_MD, scanShowcase } from '../../showcase-document';

// The `/` showcase mounts <Editor> with every bundled plugin installed the consumer way
// (subpath imports, injected latex/mermaid engines) and exposes no `window.__test` bridge, so
// this smoke asserts through rendered DOM only. It derives what it expects from the demo
// document's bytes rather than from its prose: the owner rewrites the document by hand, and a
// pinned sentence reds on the rewrite while saying nothing about whether the surface still
// works. Requirements: e2e/requirements/plugins/showcase-route.md.

const scan = scanShowcase();
const MATH_HOST = '[data-block-kind="mathBlock"], [data-block-kind="mathFence"]';
const MERMAID_HOST = '[data-block-kind="mermaid"]';

/** What one pass down the document saw. Windowing unmounts a block that scrolls away, so no
 *  single snapshot can count the whole tour — every count here is a union over the pass. */
interface Sweep {
	/** Top-level block indices that mounted at some point. */
	topLevel: number[];
	/** Those still mounted at the bottom of the scrollport, where the pass ended. */
	atBottom: number[];
	/** False when the pass ran out of steps rather than out of document. */
	reachedEnd: boolean;
	/** Block paths that rendered the raw-editable fallback or the render-error surface. */
	degraded: string[];
	/** Per math block path: whether its island mounted, and whether KaTeX painted inside it. */
	math: Record<string, { island: boolean; engine: boolean }>;
	/** Per mermaid block path: whether its island mounted. The engine renders async through a
	 *  dynamic import, so its SVG is left to the mermaid specs rather than pinned on a sweep. */
	mermaid: Record<string, { island: boolean }>;
}

async function sweepShowcase(page: Page): Promise<Sweep> {
	const editor = page.locator('.editor');
	const sweep: Sweep = {
		topLevel: [],
		atBottom: [],
		reachedEnd: false,
		degraded: [],
		math: {},
		mermaid: {}
	};
	const seenTopLevel = new Set<number>();
	const seenDegraded = new Set<string>();

	// A step under one viewport cannot skip a block: windowing mounts a buffer around the
	// visible band, and the height oracle only ever grows scrollHeight under us.
	for (let step = 0; step < 200; step++) {
		const seen = await page.evaluate(
			({ mathSelector, mermaidSelector }) => {
				const pathOf = (el: Element) =>
					el.closest('.block-host')?.getAttribute('data-block-path') ?? '?';
				const islands = (hostSelector: string, island: string, engine?: string) =>
					[...document.querySelectorAll(hostSelector)].map((host) => ({
						path: host.getAttribute('data-block-path') ?? '?',
						island: !!host.querySelector(island),
						engine: engine ? !!host.querySelector(engine) : false
					}));
				return {
					topLevel: [...document.querySelectorAll('.block-host[data-block-path]')]
						.map((host) => JSON.parse(host.getAttribute('data-block-path')!) as number[])
						.filter((path) => path.length === 1)
						.map((path) => path[0]),
					degraded: [...document.querySelectorAll('.raw-block, [data-failed-block]')].map(pathOf),
					math: islands(mathSelector, '.math-block-render', '.katex'),
					mermaid: islands(mermaidSelector, '.mermaid-block')
				};
			},
			{ mathSelector: MATH_HOST, mermaidSelector: MERMAID_HOST }
		);
		for (const index of seen.topLevel) seenTopLevel.add(index);
		for (const path of seen.degraded) seenDegraded.add(path);
		// The loop always collects before it scrolls, so the snapshot taken on the pass that
		// finds the scrollport immovable is the one taken at its end.
		sweep.atBottom = seen.topLevel;
		for (const { path, island, engine } of seen.math) {
			sweep.math[path] = {
				island: island || (sweep.math[path]?.island ?? false),
				engine: engine || (sweep.math[path]?.engine ?? false)
			};
		}
		for (const { path, island } of seen.mermaid) {
			sweep.mermaid[path] = { island: island || (sweep.mermaid[path]?.island ?? false) };
		}

		const atEnd = await editor.evaluate((el) => {
			const before = el.scrollTop;
			el.scrollTop = before + el.clientHeight * 0.8;
			return el.scrollTop <= before;
		});
		// Islands paint from an effect, so a step that only just mounted one needs a tick
		// before the next read; the union above forgives a miss, this makes it rare.
		await page.waitForTimeout(60);
		if (atEnd) {
			sweep.reachedEnd = true;
			break;
		}
	}

	sweep.topLevel = [...seenTopLevel].sort((a, b) => a - b);
	sweep.degraded = [...seenDegraded];
	return sweep;
}

test.describe('/ showcase route', () => {
	let pageErrors: string[];

	test.beforeEach(async ({ page }) => {
		// Armed before the navigation: a plugin that throws on install throws during hydration,
		// which a listener attached afterwards never sees.
		pageErrors = capturePageErrors(page);
		await page.goto('/');
		await waitForEditorHydrated(page);
	});

	test.afterEach(() => {
		expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
	});

	test('mounts the demo document as a block list', async ({ page }) => {
		// A floor well below the mounted block count, robust to a shifting window.
		await expect.poll(() => page.locator('.block-host').count()).toBeGreaterThan(10);
	});

	test('mounts every block, none of them on the raw-editable fallback', async ({ page }) => {
		const sweep = await sweepShowcase(page);

		// The premise: the tour demonstrates no kind that renders raw. A plugin that failed to
		// install leaves the parser producing `htmlBlock` for the bytes it would have claimed,
		// and that is what shows up here.
		expect(sweep.degraded, 'blocks that degraded to raw or to the render-error surface').toEqual(
			[]
		);
		// Windowing sanity: the pass ran out of document rather than out of steps, the document's
		// last block is one of those mounted at the bottom, and the indices in between form an
		// unbroken run from the first — no block skipped on the way down.
		expect(sweep.reachedEnd, 'the pass never reached the end of the scrollport').toBe(true);
		expect(sweep.atBottom).toContain(Math.max(...sweep.topLevel));
		expect(sweep.topLevel).toEqual(sweep.topLevel.map((_, index) => index));
		expect(sweep.topLevel.length).toBeGreaterThan(10);
	});

	test('renders an island for every math and mermaid block the document holds', async ({
		page
	}) => {
		const sweep = await sweepShowcase(page);

		expect(
			Object.keys(sweep.math),
			'mounted math blocks vs `$$` displays in the document'
		).toHaveLength(scan.blockMath + scan.fences.filter((info) => info === 'math').length);
		expect(Object.entries(sweep.math).filter(([, seen]) => !seen.island)).toEqual([]);
		// KaTeX output proves the injected engine ran, not merely that the island mounted.
		expect(Object.entries(sweep.math).filter(([, seen]) => !seen.engine)).toEqual([]);

		expect(Object.keys(sweep.mermaid), 'mounted mermaid blocks vs ```mermaid fences').toHaveLength(
			scan.fences.filter((info) => info === 'mermaid').length
		);
		expect(Object.entries(sweep.mermaid).filter(([, seen]) => !seen.island)).toEqual([]);
	});

	test('renders the outline exactly when the document asks for one', async ({ page }) => {
		const entries = page.locator('.toc-block-item');
		if (!/^\[\[toc\]\]\s*$/m.test(SHOWCASE_MD)) {
			await expect(entries).toHaveCount(0);
			return;
		}
		await expect(entries.first()).toBeVisible();
		// One entry per heading, so the outline walked the document rather than rendering a
		// placeholder. A mismatch here is the fs scanner disagreeing with the parser, not the
		// outline going missing — the visibility line above owns that.
		await expect(entries).toHaveCount(scan.headings.length);
	});

	test('dances the parrot exactly when the document holds a %%parrot line', async ({ page }) => {
		const parrot = page.locator('.parrot-block').first();
		if (!/^%%parrot\b/m.test(SHOWCASE_MD)) {
			await expect(page.locator('.parrot-block')).toHaveCount(0);
			return;
		}
		await expect(parrot).toBeVisible();
		await expect(parrot.locator('pre.parrot')).not.toHaveText('');
		await expect(parrot.locator('.parrot-caption')).toBeVisible();
	});
});
