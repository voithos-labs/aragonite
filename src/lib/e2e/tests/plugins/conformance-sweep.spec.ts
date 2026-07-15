import { test, expect } from '../../fixtures';
import type { Locator, Page } from '@playwright/test';
import { PluginsPage, activeBlockPath } from './helpers';
import { primaryModifier } from '../../platform';

// The three DOM-only closure columns, executed per registered kind. One test per
// COLUMN iterates the live registry entries, soft-collects a failure line per kind,
// and rolls them into a final hard assert — Playwright can't parametrize on runtime
// data across workers, and a per-kind roll-up names every offender in one failure.

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

// Neighbour paragraphs the fixture is sandwiched between. They share the word
// `filler` (the not-supported search degradation navigates between the two neighbour
// matches) and carry no letter that collides with a single-char fixture token
// (`a`, `x`), so a token drawn from a block is never a substring of a neighbour.
const BEFORE = 'top filler';
const AFTER = 'end filler';
const NEIGHBOUR_TOKEN = 'filler';

// Render-primary leaf widgets: search finds and navigates the match, but the source
// is not a measurable text node, so no rect paints. Ledgered in docs/issues.md
// ("Search matches on render-primary leaf widgets are counted but not painted"). The
// sweep pins that degraded behaviour; wiring painting later fails the guard here,
// prompting removal from this set and the ledger.
const SEARCH_MATCH_UNPAINTED = new Set(['mathBlock', 'toc']);

// `admonition`'s `:::note` fixture is shadowed by the co-registered callout dogfood
// (it claims `:::note` first) on /test/plugins, so no admonition node mounts. The
// callout `note` entry sweeps the same container-directive DOM behaviours. Any OTHER
// unreachable kind is a real regression.
const FIXTURE_UNREACHABLE = new Set(['admonition']);

const WALK_LIMIT = 30;

// ── Locate ──────────────────────────────────────────────────────────────────

// Load `BEFORE \n\n <fixture> \n\n AFTER` and resolve the fixture block. The kind is
// sought only among the MIDDLE blocks (indices 1 .. len-2): `paragraph`'s fixture is
// itself a paragraph, so a whole-document scan would match the BEFORE neighbour.
async function loadAndLocate(
	page: Page,
	plugins: PluginsPage,
	entry: SweepEntry
): Promise<{ topIndex: number | null; afterIndex: number }> {
	const doc = `${BEFORE}\n\n${entry.fixture}\n\n${AFTER}\n`;
	await page.evaluate((d) => (window as any).__test.setSource(d), doc);
	await page.waitForFunction(
		() => {
			const s = (window as any).__test.getSource() as string;
			return s.includes('top filler') && s.includes('end filler');
		},
		null,
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

// fill('') then fill(token): the bar retains its query across close/open, and a
// same-value fill fires no input event, so clearing first forces the re-scan. Then
// settle on the count reaching `expectMatches` before any overlay read — a fixed
// frame yield races the document scan, which would leave the not-supported "block
// stays clean" assertion vacuous (nothing painted anywhere yet) and flake the paint
// branches. One flush after the count settles lets the decoration paint commit.
// Returns whether the count reached `expectMatches` — a false is a soft failure the
// caller records, not a thrown timeout, so the degradation branch can name it.
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

// Poll until a sized match overlay paints in the block subtree (the painted-kind
// signal), bounded — mirrors the selection loop's shape so a slow paint flush is
// waited on, not read once and flaked.
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

	expect(unreachable.sort()).toEqual([...FIXTURE_UNREACHABLE].sort());
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

	expect(unreachable.sort()).toEqual([...FIXTURE_UNREACHABLE].sort());
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
			// Degradation: a token shared by both neighbours (>= 2 matches) paints on
			// them but never inside the block, and navigation cycles between them
			// without trapping. Settling on >= 2 matches first is what makes "block
			// stays clean" non-vacuous — the neighbours are proven to carry matches.
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

		if (SEARCH_MATCH_UNPAINTED.has(entry.kind)) {
			// Ledgered render-primary widget: the match must be FOUND (settled count),
			// but paint no rect — the two-sided ratchet. matchOverlaysIn reads settled
			// state (the count already reached >= 1, and paint commits in the same flush).
			if (!found) {
				failures.push(
					`${entry.kind} [searchPaint]: ledgered unpainted widget, but token "${entry.token}" was not found`
				);
			} else if ((await matchOverlaysIn(page, topIndex)) > 0) {
				failures.push(
					`${entry.kind} [searchPaint]: now paints a match overlay — the render-primary paint gap is fixed; update docs/issues.md and drop it from SEARCH_MATCH_UNPAINTED`
				);
			}
		} else if (!found) {
			failures.push(`${entry.kind} [searchPaint]: token "${entry.token}" was not found`);
		} else if (!(await waitForMatchOverlayIn(page, topIndex))) {
			failures.push(
				`${entry.kind} [searchPaint]: token "${entry.token}" found but painted no match overlay in the block subtree`
			);
		}
		await closeSearch(page, find);
	}

	expect(unreachable.sort()).toEqual([...FIXTURE_UNREACHABLE].sort());
	expect(failures, `\n${failures.join('\n')}`).toEqual([]);
});
