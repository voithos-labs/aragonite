import type { Page } from '@playwright/test';
import { type SimContext } from '../invariants';

// Footnote gestures for the first-party footnotes plugin (plugins route, `?seed=footnotes`
// — the plugin is seed-gated). Free functions taking `ctx` first so the Gestures class
// delegates without growing its frozen surface, mirroring gestures/directive.ts. The plugin
// spans two tiers: the `[^label]: ` strip-container definition (the listItem mold) and the
// `[^label]` inline reference widget (the `[^`-prefix ladder rung). Each gesture drives real
// keyboard/mouse, gates on the container promotion / widget swap, then resyncs the tracker
// around the reparse — never predicts across a mount boundary, where a paragraph→container
// flip or a `[^label]`→widget swap desyncs a char count. The number a reference renders is
// derived display state the tracker never models, so nothing here predicts or asserts it —
// the reference e2e is that oracle.

const DEF = '.footnote-def';
const REF = '.footnote-ref';

// ── Definition tier ───────────────────────────────────────────────────────────

/**
 * Turn the whole prose paragraph at `targetIndex` into a footnote-def strip container: select
 * its line and type `[^label]: body` over it, forming the container with one paragraph child
 * on the reparse. Marker formation from live typing. It enters over a blank-line-separated
 * paragraph rather than a paragraph split off by Enter: an Enter-split successor carries only
 * a single-newline separator, and a footnote-def is `interruptsParagraph: false`, so its line
 * would lazily merge back into the block above on reparse (the documented Enter-at-end
 * divergence, `docs/issues.md`) — a general split defect, not a footnote one, that convergence
 * would flag here.
 *
 * Typed PER KEYSTROKE, which routes the line through a transient inline reference widget: the
 * `[^label]` prefix mounts one on its closing `]`, and the `: ` plus body are typed against
 * that atomic widget's trailing edge before the reparse resolves the whole line to a
 * definition marker. That intermediate state is the one a real author produces and the one an
 * atomic insert never reaches. Settles on the container mounting (`.footnote-def` count
 * rising) plus the marker in the source, and resyncs.
 */
export async function typeFootnoteDefinition(
	ctx: SimContext,
	targetIndex: number,
	label: string,
	body: string
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const defsBefore = await page.locator(DEF).count();

	await editor.focusBlockStart(targetIndex);
	await page.keyboard.press('Shift+End');
	// The separating space is NOT typed: closing the marker with `:` auto-completes
	// it to `[^label]: `, so a literal space here would land a second one. Typing the
	// finished string as one `insertText` hid that — the editor never ran the
	// per-keystroke completion, so the whole string arrived verbatim.
	await editor.typeSlowly(`[^${label}]:`);
	await editor.typeSlowly(body);
	await editor.bridge.waitForSourceContains(`[^${label}]: ${body}`);
	await waitForNodeCount(ctx, DEF, defsBefore + 1);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Enter in the MIDDLE of the definition body child at `bodyPath` — splits it into two body
 * children INSIDE the container. The strip container inherits blockquote's split override
 * (`createContainerBlock` always wires `createBlockquoteOverrides`), so the split must grow
 * the container's own children and never the document root — the boundary Task 2's review
 * flagged untested. Asserts the parent container grew by one child and the root count held,
 * failing loud if the split escaped to the root.
 *
 * Splits mid-child, not at the child's end, deliberately: an end-split mints a trailing EMPTY
 * body child, and a footnote-def's empty continuation line carries no four-space indent, so
 * `scanDefinitionEnd` drops it as a document blank on reparse — the live two-child tree then
 * diverges from its one-child reparse (the Enter-at-end class inside the strip container,
 * `docs/issues.md`). Two non-empty children round-trip, so the mid-split pins the in-container
 * boundary without tripping that documented split defect.
 */
export async function splitFootnoteDefinitionBody(
	ctx: SimContext,
	bodyPath: number[]
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const defIndex = bodyPath[0];
	const before = await containerAndRootCounts(page, defIndex);

	const mid = await page.evaluate((path) => {
		let node = (window as any).__test.getDocument();
		for (const i of path) node = node.children?.[i];
		const raw = ((node?.raw ?? '') as string).replace(/\n+$/, '');
		return Math.max(1, Math.floor(raw.length / 2));
	}, bodyPath);
	await editor.clickBlockAtPath(bodyPath, mid);
	await page.keyboard.press('Enter');
	await page.waitForFunction(
		({ i, n }) => (window as any).__test.getDocument().children[i]?.children?.length === n,
		{ i: defIndex, n: before.children + 1 },
		{ timeout: 2000, polling: 16 }
	);

	const after = await containerAndRootCounts(page, defIndex);
	if (after.root !== before.root) {
		throw new Error(
			`[${ctx.label}] footnote-def body split escaped the container to the root ` +
				`(root ${before.root} → ${after.root}) — the blockquote split override did not hold`
		);
	}
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Backspace at the start (offset 0) of the definition's first body child. The footnote-def
 * is `not-mergeable`, so the merge walk delegates upward and the parent declines — the caret
 * lands on the block above and the bytes never change. Settles by confirming the source is
 * byte-identical (absence of mutation needs a positive re-read after the settle window, not a
 * delta wait) and fails loud if the container unwrapped into loose paragraphs.
 */
export async function footnoteDefinitionExitBackspace(
	ctx: SimContext,
	bodyPath: number[]
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();

	await editor.clickBlockAtPath(bodyPath, 0);
	await page.keyboard.press('Home');
	await page.keyboard.press('Backspace');
	await editor.waitForNoSourceMutation();

	const after = await editor.bridge.getSource();
	if (after !== before) {
		throw new Error(
			`[${ctx.label}] footnote-def unwrapped on Backspace-at-start (not-mergeable violated).\n` +
				`BEFORE: ${JSON.stringify(before)}\nAFTER:  ${JSON.stringify(after)}`
		);
	}
	tracker.resync(after);
}

// ── Reference tier ────────────────────────────────────────────────────────────

/**
 * Type `[^label]` at the caret (a prose block), mounting the atomic reference widget once
 * the closing `]` lands. The literal bytes stay in the block's raw (the widget hides but
 * preserves them), so the source carries the reference the instant it is typed — the mount
 * is the `.footnote-ref` COUNT rising, not a new substring. Resyncs around the recompute.
 */
export async function typeFootnoteReference(ctx: SimContext, label: string): Promise<void> {
	const { page, editor, tracker } = ctx;
	const refsBefore = await page.locator(REF).count();

	await editor.typeSlowly(`[^${label}]`);
	await editor.bridge.waitForSourceContains(`[^${label}]`);
	await waitForNodeCount(ctx, REF, refsBefore + 1);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Caret-enter the reference widget at `refIndex` (document order) to reveal its raw source,
 * then blur onto `blurBlockIndex` to fold it back. A pure view toggle: the source is
 * dimmed-but-present in both states, so the widget COUNT is the only reveal signal, and the
 * bytes must be identical across the whole round trip. Fails loud if the reveal or fold
 * moved a byte.
 */
export async function revealFootnoteReference(
	ctx: SimContext,
	refIndex: number,
	blurBlockIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const refsBefore = await page.locator(REF).count();

	const island = await nthRefIsland(page, refIndex);
	await editor.focusBlockAtPath(island.blockPath, island.start);
	await page.keyboard.press('ArrowRight');
	await waitForNodeCount(ctx, REF, refsBefore - 1);

	await editor.clickBlock(blurBlockIndex);
	await waitForNodeCount(ctx, REF, refsBefore);
	await editor.waitForRenderFlush();

	const after = await editor.bridge.getSource();
	if (after !== before) {
		throw new Error(
			`[${ctx.label}] reference reveal→fold changed the source (view toggle must be byte-stable).\n` +
				`BEFORE: ${JSON.stringify(before)}\nAFTER:  ${JSON.stringify(after)}`
		);
	}
	tracker.resync(after);
}

/**
 * Reveal the reference widget at `refIndex`, insert `text` at the start of its label (just
 * past `[^`), and commit with Enter — the reveal→edit→commit UX the widget shares with inline
 * math. The edit is suppressed from the CST until commit, so the source delta appears only
 * after Enter; settling on it before would race the ephemeral reveal DOM. Resyncs around the
 * committed bytes.
 */
export async function editFootnoteLabel(
	ctx: SimContext,
	refIndex: number,
	text: string
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();

	const island = await nthRefIsland(page, refIndex);
	await editor.focusBlockAtPath(island.blockPath, island.start);
	await page.keyboard.press('ArrowRight'); // reveal (caret at the revealed leading edge)
	await page.keyboard.press('ArrowRight'); // past `[`
	await page.keyboard.press('ArrowRight'); // past `^` — now at the label start
	await page.keyboard.type(text);
	await page.keyboard.press('Enter');

	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Degrade the reference widget at `refIndex` to literal text. A destructive key adjacent to
 * a folded reference reveals it rather than deleting it whole (the reveal policy), so the
 * first Delete only reveals; the second deletes the opening `[`, and Enter commits the now
 * `^label]` run as ordinary text — the reference is gone but its remaining bytes stay. The
 * caller nets it to identity with a trailing undo. Settles on the widget count dropping.
 */
export async function deleteFootnoteReference(ctx: SimContext, refIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const refsBefore = await page.locator(REF).count();

	const island = await nthRefIsland(page, refIndex);
	await editor.focusBlockAtPath(island.blockPath, island.start);
	await page.keyboard.press('Delete'); // reveal, no byte deleted
	await page.keyboard.press('Delete'); // remove the opening `[`
	await page.keyboard.press('Enter'); // commit → literal text
	await waitForNodeCount(ctx, REF, refsBefore - 1);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

// ── Internal ────────────────────────────────────────────────────────────────

/** Block path + `data-source-start` offset of the Nth rendered reference widget island. */
async function nthRefIsland(
	page: Page,
	refIndex: number
): Promise<{ blockPath: number[]; start: number }> {
	return page.evaluate((idx) => {
		const sup = document.querySelectorAll('.footnote-ref')[idx];
		if (!sup) throw new Error(`no .footnote-ref at index ${idx}`);
		const island = sup.closest('[data-inline-widget]');
		const host = sup.closest('[data-block-path]');
		const path = host?.getAttribute('data-block-path');
		const start = island?.getAttribute('data-source-start');
		if (path === null || path === undefined || start === null || start === undefined) {
			throw new Error('footnote-ref island/host is missing its offset attributes');
		}
		return { blockPath: JSON.parse(path) as number[], start: Number(start) };
	}, refIndex);
}

/** Body-child count of the container at `defIndex` and the document root count, together. */
async function containerAndRootCounts(
	page: Page,
	defIndex: number
): Promise<{ children: number; root: number }> {
	return page.evaluate((i) => {
		const doc = (window as any).__test.getDocument();
		return { children: doc.children[i]?.children?.length ?? 0, root: doc.children.length };
	}, defIndex);
}

async function waitForNodeCount(ctx: SimContext, selector: string, count: number): Promise<void> {
	await ctx.page.waitForFunction(
		({ sel, n }) => document.querySelectorAll(sel).length === n,
		{ sel: selector, n: count },
		{ timeout: 2000, polling: 16 }
	);
}
