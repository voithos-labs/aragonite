import { test, expect } from '../../fixtures';
import type { Locator, Page } from '@playwright/test';
import { PluginsPage, activeBlockPath } from './helpers';

// The three DOM-only closure columns, run for every registered kind. One test per column walks the
// live registry entries, collects a failure line per kind and asserts on the whole list at the end,
// because Playwright cannot parametrize on runtime data across workers and one roll-up names every
// offender in a single failure.

interface SweepEntry {
	kind: string;
	fixture: string;
	token: string | null;
	wholeBlock: boolean;
	cells: {
		focus: { mode: string };
		selectionPaint: { mode: string };
		searchPaint: { mode: string };
	};
}

// Neighbour paragraphs around the fixture. Both hold `filler`, so the not-supported search case
// has two matches to move between, and no letter a single-character fixture token could match.
const BEFORE = 'top filler';
const AFTER = 'end filler';
const NEIGHBOUR_TOKEN = 'filler';

const WALK_LIMIT = 30;

// Every column test iterates what the bridge returns, so a kind dropped from enrollment would pass
// silently. A subset check, so new kinds enroll without touching this floor.
const ENROLLMENT_FLOOR = [
	'paragraph',
	'heading',
	'table',
	'blockquote',
	'mermaid',
	'mathBlock',
	'toc',
	'callout',
	'admonition'
];

// ── Enrollment ────────────────────────────────────────────────────────────────

test('enrollment covers the known-kind floor', async ({ page }) => {
	const plugins = new PluginsPage(page);
	await plugins.gotoPlugins();
	const kinds: string[] = await page.evaluate(() =>
		(window as any).__test.getConformanceEntries().map((e: SweepEntry) => e.kind)
	);
	const missing = ENROLLMENT_FLOOR.filter((k) => !kinds.includes(k));
	expect(missing, 'kinds dropped from sweep enrollment').toEqual([]);
});

// ── Locate ──────────────────────────────────────────────────────────────────

// Only the middle blocks are searched for the kind, since `paragraph`'s fixture is itself a
// paragraph and would match the `BEFORE` neighbour.
async function loadAndLocate(
	page: Page,
	plugins: PluginsPage,
	entry: SweepEntry
): Promise<{ topIndex: number | null; afterIndex: number }> {
	const doc = `${BEFORE}\n\n${entry.fixture}\n\n${AFTER}\n`;
	await plugins.loadContent(doc);
	await plugins.waitForRenderFlush();
	return page.evaluate((kind) => {
		const root = (window as any).__test.getDocument();
		const has = (node: any): boolean => node.kind === kind || (node.children ?? []).some(has);
		let topIndex: number | null = null;
		for (let i = 1; i <= root.children.length - 2; i++) {
			if (has(root.children[i])) {
				topIndex = i;
				break;
			}
		}
		return { topIndex, afterIndex: root.children.length - 1 };
	}, entry.kind);
}

// ── Overlay reads ─────────────────────────────────────────────────────────────

async function sizedSelectionOverlayIn(page: Page, topIndex: number): Promise<boolean> {
	return page.evaluate((t) => {
		const host = document.querySelector(`[data-block-path='[${t}]']`);
		if (!host) return false;
		return Array.from(host.querySelectorAll('.selection-overlay')).some((el) => {
			const b = el.getBoundingClientRect();
			return b.width > 0 && b.height > 0;
		});
	}, topIndex);
}

async function matchOverlaysIn(page: Page, topIndex: number): Promise<number> {
	return page.evaluate((t) => {
		const host = document.querySelector(`[data-block-path='[${t}]']`);
		return host ? host.querySelectorAll('.match-overlay').length : 0;
	}, topIndex);
}

// ── Search driving ────────────────────────────────────────────────────────────

async function openSearch(page: Page, plugins: PluginsPage, find: Locator): Promise<void> {
	await plugins.clickBlock(0);
	await page.keyboard.press('ControlOrMeta+f');
	await find.waitFor({ state: 'visible' });
}

// Clearing first forces a re-scan (a same-value fill fires no input), and the count wait keeps a
// frame yield from racing the scan. Returns false for the caller to name.
async function runQuery(
	page: Page,
	plugins: PluginsPage,
	find: Locator,
	token: string,
	expectMatches: number
): Promise<boolean> {
	await find.fill('');
	await find.fill(token);
	try {
		await page.waitForFunction(
			(min) => {
				const text = document.querySelector('.search-count')?.textContent ?? '';
				const m = text.match(/\d+\s*\/\s*(\d+)/);
				return m ? Number(m[1]) >= min : false;
			},
			expectMatches,
			{ timeout: 3000, polling: 16 }
		);
	} catch {
		return false;
	}
	await plugins.waitForRenderFlush();
	return true;
}

// Polls, bounded, for a sized match overlay in the block's subtree, so a slow paint is waited for.
async function waitForMatchOverlayIn(
	page: Page,
	topIndex: number,
	timeout = 5000
): Promise<boolean> {
	try {
		await page.waitForFunction(
			(t) => !!document.querySelector(`[data-block-path='[${t}]'] .match-overlay`),
			topIndex,
			{ timeout, polling: 16 }
		);
		return true;
	} catch {
		return false;
	}
}

async function closeSearch(page: Page, find: Locator): Promise<void> {
	await page.keyboard.press('Escape');
	await find.waitFor({ state: 'hidden' });
}

// Advance the active match `steps` times; report whether it ever lands inside the
// given block subtree. The not-supported degradation requires it never does.
async function activeMatchEverLandsIn(
	page: Page,
	plugins: PluginsPage,
	topIndex: number,
	steps: number
): Promise<boolean> {
	for (let i = 0; i < steps; i++) {
		const inBlock = await page.evaluate((t) => {
			const active = document.querySelector('.match-overlay-active');
			const host = active?.closest('[data-block-path]');
			return host?.getAttribute('data-block-path') === `[${t}]`;
		}, topIndex);
		if (inBlock) return true;
		await page.keyboard.press('Enter');
		await plugins.waitForRenderFlush();
	}
	return false;
}

// ── Focus walk ────────────────────────────────────────────────────────────────

interface SweepResult {
	failures: string[];
	unreachable: string[];
}

/** Every enrolled kind must mount from its own fixture; an unreachable one is a lost registrar. */
function expectSweepClean({ failures, unreachable }: SweepResult): void {
	expect(unreachable, 'enrolled kinds whose fixture mounted no node').toEqual([]);
	expect(failures, `\n${failures.join('\n')}`).toEqual([]);
}

/** Null when focus sits on a whole-block kind's hidden editing host, where typed input and IME
 *  composition arrive; otherwise the element that holds focus instead. */
async function focusOffWholeBlockHost(page: Page): Promise<string | null> {
	return page.evaluate(() => {
		const active = document.activeElement;
		if (active?.hasAttribute('data-whole-block-input')) return null;
		return active ? `<${active.tagName.toLowerCase()} class="${active.className}">` : 'nothing';
	});
}

async function sweepFocusWalk(page: Page, plugins: PluginsPage): Promise<SweepResult> {
	const entries: SweepEntry[] = await page.evaluate(() =>
		(window as any).__test.getConformanceEntries()
	);
	const failures: string[] = [];
	const unreachable: string[] = [];

	for (const entry of entries) {
		const { topIndex, afterIndex } = await loadAndLocate(page, plugins, entry);
		if (topIndex === null) {
			unreachable.push(entry.kind);
			continue;
		}

		await plugins.focusBlockStart(0);
		let entered = false;
		let exited = false;
		let offHost: string | null = null;
		for (let i = 0; i < WALK_LIMIT && !exited; i++) {
			await page.keyboard.press('ArrowDown');
			await plugins.waitForRenderFlush();
			const path = await activeBlockPath(page);
			if (path && path[0] === topIndex) {
				entered = true;
				if (entry.wholeBlock) offHost ??= await focusOffWholeBlockHost(page);
			}
			if (path && path.length === 1 && path[0] === afterIndex) exited = true;
		}

		if (!exited) {
			failures.push(
				`${entry.kind} [focus]: caret never reached the paragraph below in ${WALK_LIMIT} ArrowDowns (possible trap)`
			);
			continue;
		}
		if (entry.cells.focus.mode === 'not-supported') {
			if (entered) {
				failures.push(
					`${entry.kind} [focus]: declared not-supported but the caret entered its subtree`
				);
			}
		} else if (!entered) {
			failures.push(
				`${entry.kind} [focus]: declared ${entry.cells.focus.mode} but the caret skipped its subtree`
			);
		}
		if (offHost) {
			failures.push(
				`${entry.kind} [focus]: whole-block focus landed on ${offHost}, not the hidden editing host`
			);
		}

		// Assert the landing by typing, not by reading the source (a marker in the
		// paragraph below confirms focus exited to it).
		await page.keyboard.type('Q');
		const landed = await page.evaluate(
			(i) => ((window as any).__test.getDocument().children[i]?.raw ?? '').includes('Q'),
			afterIndex
		);
		if (!landed) {
			failures.push(`${entry.kind} [focus]: marker did not land in the paragraph below after exit`);
		}
	}

	return { failures, unreachable };
}

test('focus walk enters and exits each kind without trapping', async ({ page }) => {
	const plugins = new PluginsPage(page);
	await plugins.gotoPlugins();
	expectSweepClean(await sweepFocusWalk(page, plugins));
});

// The same walk under a marker-hiding mode: a kind that puts marker-only text in its editable
// area trips the caret and typing checks here rather than in a consumer's document (G1.33).
test('focus walk under live mode enters and exits each kind, tripping no invariant', async ({
	page
}) => {
	const plugins = new PluginsPage(page);
	await plugins.gotoPlugins();
	await plugins.setPresentationMode('live');
	expectSweepClean(await sweepFocusWalk(page, plugins));
});

// ── Selection paint ────────────────────────────────────────────────────────────

test('cross-block selection paints within each kind', async ({ page }) => {
	const plugins = new PluginsPage(page);
	await plugins.gotoPlugins();
	const entries: SweepEntry[] = await page.evaluate(() =>
		(window as any).__test.getConformanceEntries()
	);
	const failures: string[] = [];
	const unreachable: string[] = [];

	for (const entry of entries) {
		const { topIndex } = await loadAndLocate(page, plugins, entry);
		if (topIndex === null) {
			unreachable.push(entry.kind);
			continue;
		}

		await plugins.focusBlockStart(0);
		let painted = false;
		for (let i = 0; i < WALK_LIMIT && !painted; i++) {
			await page.keyboard.press('Shift+ArrowDown');
			await plugins.waitForRenderFlush();
			painted = await sizedSelectionOverlayIn(page, topIndex);
		}
		if (!painted) {
			failures.push(
				`${entry.kind} [selectionPaint]: a cross-block selection into the block painted no sized overlay in its subtree`
			);
		}
		// Collapse before the next kind loads.
		await page.keyboard.press('ArrowRight');
	}

	expectSweepClean({ failures, unreachable });
});

// ── Search paint ───────────────────────────────────────────────────────────────

test('search paints or degrades per kind', async ({ page }) => {
	const plugins = new PluginsPage(page);
	await plugins.gotoPlugins();
	const entries: SweepEntry[] = await page.evaluate(() =>
		(window as any).__test.getConformanceEntries()
	);
	const find = page.getByRole('textbox', { name: 'Find' });
	const failures: string[] = [];
	const unreachable: string[] = [];

	for (const entry of entries) {
		const { topIndex } = await loadAndLocate(page, plugins, entry);
		if (topIndex === null) {
			unreachable.push(entry.kind);
			continue;
		}

		await openSearch(page, plugins, find);

		if (entry.cells.searchPaint.mode === 'not-supported') {
			// A token both neighbours share paints on them, never inside the block, and navigation cycles
			// without trapping; waiting for two matches keeps "block stays clean" from passing vacuously.
			if (!(await runQuery(page, plugins, find, NEIGHBOUR_TOKEN, 2))) {
				failures.push(
					`${entry.kind} [searchPaint]: the neighbour matches never appeared — degradation unverifiable`
				);
			} else {
				const inBlock = await matchOverlaysIn(page, topIndex);
				if (inBlock > 0) {
					failures.push(
						`${entry.kind} [searchPaint]: not-supported but ${inBlock} match overlay(s) painted inside the block`
					);
				}
				if (await activeMatchEverLandsIn(page, plugins, topIndex, 4)) {
					failures.push(
						`${entry.kind} [searchPaint]: navigation landed the active match on the non-searchable block (trap)`
					);
				}
			}
			await closeSearch(page, find);
			continue;
		}

		// A kind that implements search paint.
		if (!entry.token) {
			failures.push(
				`${entry.kind} [searchPaint]: implemented but the fixture yielded no search token`
			);
			await closeSearch(page, find);
			continue;
		}
		if (BEFORE.includes(entry.token) || AFTER.includes(entry.token)) {
			failures.push(
				`${entry.kind} [searchPaint]: token "${entry.token}" also occurs in a neighbour — not attributable`
			);
			await closeSearch(page, find);
			continue;
		}
		const found = await runQuery(page, plugins, find, entry.token, 1);

		if (!found) {
			failures.push(`${entry.kind} [searchPaint]: token "${entry.token}" was not found`);
		} else if (!(await waitForMatchOverlayIn(page, topIndex))) {
			failures.push(
				`${entry.kind} [searchPaint]: token "${entry.token}" found but painted no match overlay in the block subtree`
			);
		}
		await closeSearch(page, find);
	}

	expectSweepClean({ failures, unreachable });
});
