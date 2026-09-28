import { type Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { capturePageErrors } from '../../page-probes';
import { gotoReady } from '../../goto-ready';
import { SHOWCASE_MD, scanShowcase } from '../../showcase-document';

// The `/` showcase mounts <Editor> with every bundled plugin the way a consumer would, with no
// `window.__test` bridge, so this smoke test reads the rendered DOM. Expectations come from the
// demo document's bytes rather than its prose, which is rewritten by hand. Requirements:
// e2e/requirements/plugins/showcase-route.md.

const scan = scanShowcase();
const MATH_HOST = '[data-block-kind="mathBlock"], [data-block-kind="mathFence"]';
const MERMAID_HOST = '[data-block-kind="mermaid"]';

/** What one pass down the document saw. A block that scrolls away is unmounted, so no single
 *  snapshot can count the whole tour, and every count here is the union over the pass. */
interface Sweep {
	/** Top-level block indices that mounted at some point. */
	topLevel: number[];
	/** Those still mounted at the bottom of the scroll container, where the pass ended. */
	atBottom: number[];
	/** False when the pass ran out of steps rather than out of document. */
	reachedEnd: boolean;
	/** Block paths that rendered the editable-raw fallback or the render-error box. */
	degraded: string[];
	/** Per math block path: whether its widget mounted, and whether KaTeX painted inside it. */
	math: Record<string, { island: boolean; engine: boolean }>;
	/** Per mermaid block path: whether its widget mounted; its async SVG is left to the mermaid
	 *  specs. */
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

	// A step shorter than one viewport cannot skip a block: windowing mounts a margin around what
	// is visible, and the height estimates only ever make scrollHeight grow.
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
		// The loop always collects before it scrolls, so the snapshot taken on the pass that finds
		// the scroll container immovable is the one taken at its end.
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
		// Widgets paint from an effect, so a step that only just mounted one needs a tick before
		// the next read; the union above forgives a miss, and this makes one rare.
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
		// Set up before the navigation: a plugin that throws on install throws during hydration,
		// which a listener attached afterwards never sees.
		pageErrors = capturePageErrors(page);
		await gotoReady(page, '/', '__parityDocuments');
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

		// The tour shows no kind that renders as raw text: a plugin that failed to install leaves its
		// bytes as `htmlBlock`.
		expect(sweep.degraded, 'blocks that degraded to raw or to the render-error surface').toEqual(
			[]
		);
		// The pass ran out of document rather than steps, the last block is mounted at the bottom, and
		// the indices run unbroken from the first, so no block was skipped.
		expect(sweep.reachedEnd, 'the pass never reached the end of the scrollport').toBe(true);
		expect(sweep.atBottom).toContain(Math.max(...sweep.topLevel));
		expect(sweep.topLevel).toEqual(sweep.topLevel.map((_, index) => index));
		expect(sweep.topLevel.length).toBeGreaterThan(10);
	});

	test('renders a widget for every math and mermaid block the document holds', async ({ page }) => {
		const sweep = await sweepShowcase(page);

		expect(
			Object.keys(sweep.math),
			'mounted math blocks vs `$$` displays in the document'
		).toHaveLength(scan.blockMath + scan.fences.filter((info) => info === 'math').length);
		expect(Object.entries(sweep.math).filter(([, seen]) => !seen.island)).toEqual([]);
		// KaTeX output shows the injected renderer ran, not just that the widget mounted.
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
		// One entry per heading; a mismatch means the file scan disagrees with the parser, since the
		// visibility check above covers a missing outline.
		await expect(entries).toHaveCount(scan.headings.length);
	});

	test('dances the parrot exactly when the document holds a %%parrot line', async ({ page }) => {
		const parrot = page.locator('.parrot-block').first();
		if (!/^%%parrot\b/m.test(SHOWCASE_MD)) {
			await expect(page.locator('.parrot-block')).toHaveCount(0);
			return;
		}
		await expect(parrot).toBeVisible();
		await expect(parrot.locator('pre.parrot-reel')).not.toHaveText('');
		await expect(parrot.locator('.parrot-caption')).toBeVisible();
	});
});
