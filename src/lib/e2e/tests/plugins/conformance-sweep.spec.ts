import { test, expect } from '../../fixtures';
import type { Locator, Page } from '@playwright/test';
import { PluginsPage, activeBlockPath } from './helpers';
import { primaryModifier } from '../../platform';

// The three DOM-only closure columns, executed per registered kind. One test per COLUMN iterates
// the live registry entries, soft-collects a failure line per kind, and rolls them into a final
// hard assert — Playwright can't parametrize on runtime data across workers, and a per-kind roll-up
// names every offender in one failure.

interface SweepEntry {
	kind: string;
	fixture: string;
	token: string | null;
	cells: {
		focus: { mode: string };
		selectionPaint: { mode: string };
		searchPaint: { mode: string };
	};
}

// Neighbour paragraphs the fixture is sandwiched between. They share the word `filler` (the
// not-supported search degradation navigates between the two neighbour matches) and carry no letter
// that collides with a single-char fixture token, so a token drawn from a block is never a
// substring of a neighbour.
const BEFORE = 'top filler';
const AFTER = 'end filler';
const NEIGHBOUR_TOKEN = 'filler';

const WALK_LIMIT = 30;

// Every column test iterates whatever the bridge returns, so a kind silently dropped from
// enrollment (a lost fixture, a broken registrar) would vanish green. Subset, not equality: new
// kinds enroll without touching this floor.
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

// Every load gets a unique leading-trivia prefix: the harness's setSource writes a `source` $state
// and a same-value write is a Svelte no-op, so with two kinds sharing a byte-identical fixture doc
// a prior iteration's typed mutation would survive into the next kind's run. Blank lines are
// lossless leadingTrivia — no block, no searchable text, block indices unchanged.
let loadSeq = 0;

// Load `BEFORE / fixture / AFTER` and resolve the fixture block. The kind is sought only among the
// MIDDLE blocks: `paragraph`'s fixture is itself a paragraph, so a whole-document scan would match
// the BEFORE neighbour.
async function loadAndLocate(
	page: Page,
	plugins: PluginsPage,
	entry: SweepEntry
): Promise<{ topIndex: number | null; afterIndex: number }> {
	const doc = `${'\n'.repeat(loadSeq++)}${BEFORE}\n\n${entry.fixture}\n\n${AFTER}\n`;
	await page.evaluate((d) => (window as any).__test.setSource(d), doc);
	// Exact-source settle: every sweep document carries both fillers, so an includes() predicate is
	// satisfiable by the PRIOR kind's stale document. serialize() normalizes trailing whitespace;
	// compare trimmed forms.
	await page.waitForFunction(
		(expected) => {
			const actual = (window as any).__test.getSource() as string;
			return actual.replace(/\s+$/, '') === expected.replace(/\s+$/, '');
		},
		doc,
		{ timeout: 3000, polling: 16 }
	);
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

// ── Overlay probes ────────────────────────────────────────────────────────────

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
	await page.keyboard.press(`${primaryModifier}+f`);
	await find.waitFor({ state: 'visible' });
}

// fill('') then fill(token): the bar retains its query across close/open and a same-value fill
// fires no input event, so clearing first forces the re-scan. Settle on the count reaching
// `expectMatches` before any overlay read — a fixed frame yield races the document scan and would
// leave the not-supported "block stays clean" assertion vacuous. Returns false rather than
// throwing, so the caller can name the soft failure.
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

// Poll until a sized match overlay paints in the block subtree (the painted-kind signal), bounded —
// mirrors the selection loop's shape so a slow paint flush is waited on, not read once and flaked.
async function waitForMatchOverlayIn(
	page: Page,
	topIndex: number,
	timeout = 2000
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

test('focus walk enters and exits each kind without trapping', async ({ page }) => {
	const plugins = new PluginsPage(page);
	await plugins.gotoPlugins();
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
		for (let i = 0; i < WALK_LIMIT && !exited; i++) {
			await page.keyboard.press('ArrowDown');
			await plugins.waitForRenderFlush();
			const path = await activeBlockPath(page);
			if (path && path[0] === topIndex) entered = true;
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

	// Every enrolled kind must mount from its own fixture; an unreachable one is a lost registrar.
	expect(unreachable, 'enrolled kinds whose fixture mounted no node').toEqual([]);
	expect(failures, `\n${failures.join('\n')}`).toEqual([]);
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

	// Every enrolled kind must mount from its own fixture; an unreachable one is a lost registrar.
	expect(unreachable, 'enrolled kinds whose fixture mounted no node').toEqual([]);
	expect(failures, `\n${failures.join('\n')}`).toEqual([]);
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
			// Degradation: a token shared by both neighbours paints on them but never inside the
			// block, and navigation cycles between them without trapping. Settling on >= 2 matches
			// first is what makes "block stays clean" non-vacuous — the neighbours are proven to
			// carry matches.
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

		// implemented
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

	// Every enrolled kind must mount from its own fixture; an unreachable one is a lost registrar.
	expect(unreachable, 'enrolled kinds whose fixture mounted no node').toEqual([]);
	expect(failures, `\n${failures.join('\n')}`).toEqual([]);
});
