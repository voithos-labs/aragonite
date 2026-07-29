import type { Gestures } from '../gestures';
import { primaryModifier } from '../../platform';
import {
	type SimContext,
	assertParseConvergence,
	assertStructuralIntegrity,
	settleTypedSource
} from '../invariants';

/**
 * The select-all → gesture → keystroke family: a live cross-block range, an
 * interrupting gesture, then ONE printable key. Two whole-document losses hid behind
 * exactly this precondition — the dead-space click and the render-primary reveal
 * click both placed a caret while the range stayed live, so the next key
 * type-replaced everything the user could see. G2.12 pins the pointer perimeter by
 * source inspection; this is the behavioral half, and it outlives any reshaping of
 * that lint's entry list because nothing here reads it.
 *
 * ## The oracle
 *
 * Each gesture is pinned to ONE of two legal outcomes, and the byte assertion is
 * equality against that one — never membership in the pair. Membership is the trap:
 * with the reset neutered, the dead-space click's corrupt output IS the other
 * outcome, so an "either is fine" oracle ships green for the exact bug it exists to
 * catch. Reading the outcome back off `isCrossBlockActive()` after the gesture is
 * the same trap wearing a disguise — the neutered path leaves that flag true and
 * self-confirms.
 *
 * - `range` — the gesture left the range live: the key replaces exactly it.
 * - `caret` / `block` / `reveal` — the gesture ended the range: the key lands where
 *   the gesture left it pointed (a caret, a whole selected block, or a reveal buffer
 *   whose bytes stay ephemeral until the escape commits them).
 *
 * Every prediction is one contiguous byte splice of the pre-gesture source, so no
 * outcome needs its own arithmetic: the endpoints come from the live top-level block
 * spans and the selection the editor reports.
 *
 * ## Where the contracts come from
 *
 * Observation, not the G2.12 tables. Each `consumes` below was read off a real run
 * of that gesture over a live range; the lint's caret/non-caret classification is a
 * hypothesis about the same behavior, and pinning to it would make this suite a
 * mirror of the thing it is supposed to cross-check. When T22 teaches the dead-space
 * click to land in a table, `dead-space-below-table` flips from `range` to `caret`
 * here, deliberately and in one line.
 *
 * The build is chosen per gesture on the same reasoning: a caret-pinned gesture
 * prefers select-all, where the corruption is a one-char document and maximally far
 * from the prediction; a range-pinned gesture must use a short prose range, because
 * there select-all's prediction WOULD be the one-char document and all
 * discriminating power is lost. A caret landing at byte 0 of the document is the one
 * case that overrides the preference — see `escape`.
 */

export type RangeInterruptGesture =
	| 'dead-space-below'
	| 'dead-space-below-table'
	| 'dead-space-margin'
	| 'image-click'
	| 'drag-handle-press'
	| 'escape'
	| 'search-round-trip'
	| 'inline-reveal-click'
	| 'toc-entry-click';

/** What the one printable key is predicted to consume. */
type Consumes = 'range' | 'caret' | 'block' | 'reveal';

interface GestureSpec {
	consumes: Consumes;
	build: 'select-all' | 'prose-range';
	/** Returns the top-level block index the gesture selected, for `consumes: 'block'`. */
	act(ctx: SimContext): Promise<number | undefined>;
}

const SPECS: Record<RangeInterruptGesture, GestureSpec> = {
	'dead-space-below': { consumes: 'caret', build: 'select-all', act: clickBelowLastBlock },
	// Today's contract: a table addresses cells, not characters, so the click declines
	// and the range it found is the range it leaves. T22 flips this to `caret`.
	'dead-space-below-table': { consumes: 'range', build: 'prose-range', act: clickBelowLastBlock },
	'dead-space-margin': { consumes: 'caret', build: 'select-all', act: clickInRightMargin },
	'image-click': { consumes: 'block', build: 'select-all', act: clickImageWidget },
	'drag-handle-press': { consumes: 'range', build: 'prose-range', act: pressDragHandle },
	// The one caret-pinned gesture on a prose range: Escape collapses to the range's
	// ANCHOR, and a select-all anchor is byte 0 of the document. Typing there demotes the
	// first block's kind, which — when the block below is tightly joined — enters the
	// deferred lazy-continuation class in `docs/issues.md` and reds the convergence
	// oracle for a reason this probe is not about. A prose-range anchor is interior.
	escape: { consumes: 'caret', build: 'prose-range', act: pressEscape },
	'search-round-trip': { consumes: 'range', build: 'prose-range', act: searchRoundTrip },
	'inline-reveal-click': { consumes: 'reveal', build: 'select-all', act: clickInlineMathWidget },
	// Navigation lands at the heading's offset 0, so the fixture keeps a blank line under
	// that heading — the same lazy-continuation class Escape avoids by its build.
	'toc-entry-click': { consumes: 'caret', build: 'select-all', act: clickTocEntry }
};

/** Union-derived manifest: a gesture cannot join the family without a spec or a probe. */
export const RANGE_INTERRUPT_GESTURES = Object.keys(SPECS) as RangeInterruptGesture[];

/**
 * Build the range, fire the gesture, type one key, and assert the bytes against the
 * gesture's pinned outcome — then undo back to where it started, so a session's
 * end-state equality still holds. The gesture itself must move no bytes; one that
 * does is a finding, not something to fold into the baseline.
 */
export async function rangeInterrupt(
	ctx: SimContext,
	g: Gestures,
	gesture: RangeInterruptGesture
): Promise<void> {
	const spec = SPECS[gesture];
	const before = await ctx.editor.bridge.getSource();
	const char = probeChar(before);

	await g.pause();
	const range =
		spec.build === 'prose-range' ? await buildProseRange(ctx, g) : await buildSelectAll(ctx, g);

	const consumedBlock = await spec.act(ctx);
	await ctx.editor.waitForRenderFlush();

	const afterGesture = await ctx.editor.bridge.getSource();
	if (afterGesture !== before) {
		throw new Error(
			`[${ctx.label}] range-interrupt ${gesture} moved bytes before the keystroke.\n` +
				`BEFORE: ${JSON.stringify(before)}\nAFTER:  ${JSON.stringify(afterGesture)}`
		);
	}
	ctx.tracker.resync(afterGesture);
	await assertRangeContract(ctx, gesture, spec.consumes, range);

	const landing = await ctx.editor.bridge.getSelectionPaths();
	const spans = await topLevelSpans(ctx);
	const predicted = predict({
		ctx,
		gesture,
		spec,
		before,
		char,
		range,
		spans,
		landing,
		consumedBlock
	});

	await ctx.editor.typeSlowly(char);
	if (spec.consumes === 'reveal') {
		await assertRevealEphemeral(ctx, gesture, before);
		await commitReveal(ctx, before);
	}
	await settleTypedSource(ctx, predicted);
	if (landing && landing.focus.path.length > 1) {
		assertInsertionInsideBlock(ctx, gesture, before, predicted, spans[landing.focus.path[0]]);
	}

	await assertStructuralIntegrity(ctx);
	await assertParseConvergence(ctx);
	ctx.tracker.resync(await ctx.editor.bridge.getSource());

	await g.pause();
	await g.undo();
	await ctx.editor.bridge.waitForSourceEquals(before, 3000);
	ctx.tracker.resync(before);
}

/**
 * The gestures this document can actually reach, in a fixed order so a seed's pick is
 * replayable. Availability is read off the live tree rather than declared per note, so
 * a fixture that grows an image gains the widget probe without editing a list.
 */
export async function availableRangeInterrupts(ctx: SimContext): Promise<RangeInterruptGesture[]> {
	const shape = await ctx.page.evaluate(() => {
		const doc = (window as any).__test.getDocument();
		const kinds = doc.children.map((c: { kind: string }) => c.kind as string);
		return {
			lastKind: kinds[kinds.length - 1] ?? '',
			lastRaw: (doc.children[doc.children.length - 1]?.raw ?? '') as string,
			images: document.querySelectorAll('[data-image-widget]').length
		};
	});
	const available: RangeInterruptGesture[] = ['dead-space-margin', 'drag-handle-press', 'escape'];
	// The band below the last block clamps onto that block, so the click only lands a
	// caret when the last block offers a character position: a rule has none, and an
	// image-only paragraph's sole child is a widget.
	if (PROSE_KINDS.has(shape.lastKind) && !shape.lastRaw.trimStart().startsWith('![')) {
		available.push('dead-space-below');
	}
	if (shape.images > 0) available.push('image-click');
	available.push('search-round-trip');
	return available;
}

const PROSE_KINDS = new Set(['paragraph', 'heading', 'setextHeading']);

// ── Range builds ────────────────────────────────────────────────────────────

interface RangePoint {
	path: number[];
	offset: number;
}
interface BuiltRange {
	anchor: RangePoint;
	focus: RangePoint;
}

/**
 * Escalate a caret in the first leaf block to the whole document. The double Ctrl+A
 * needs a caret to escalate FROM, and the leaf is the one block guaranteed not to
 * reveal a render-primary source under it.
 */
async function buildSelectAll(ctx: SimContext, g: Gestures): Promise<BuiltRange> {
	const leaves = await topLevelLeaves(ctx);
	await ctx.editor.focusBlockAtPath([leaves[0]], 1);
	await g.selectWholeDocument();
	return readRange(ctx, 'select-all');
}

/**
 * Shift+Click a range between the first two top-level LEAF blocks. Leaf endpoints
 * past their markers keep the collapse a pure byte splice — the anchor block's marker
 * survives in the head, the focus block's is inside the removed span — which is what
 * lets the `range` prediction be exact without modelling merge rules.
 */
async function buildProseRange(ctx: SimContext, g: Gestures): Promise<BuiltRange> {
	const leaves = await topLevelLeaves(ctx);
	if (leaves.length < 2) {
		throw new Error(`[${ctx.label}] range-interrupt needs two top-level leaf blocks to span`);
	}
	await ctx.editor.focusBlockAtPath([leaves[0]], 2);
	await g.shiftClickAcross([leaves[1]], 2);
	return readRange(ctx, 'prose-range');
}

/** Top-level blocks with no children and enough content for an interior offset. */
async function topLevelLeaves(ctx: SimContext): Promise<number[]> {
	const leaves = await ctx.page.evaluate(() => {
		const children = (window as any).__test.getDocument().children as {
			raw: string;
			children?: unknown[];
		}[];
		const out: number[] = [];
		children.forEach((c, i) => {
			const isLeaf = !Array.isArray(c.children) || c.children.length === 0;
			if (isLeaf && c.raw.trim().length >= 6) out.push(i);
		});
		return out;
	});
	if (leaves.length === 0) {
		throw new Error(`[${ctx.label}] range-interrupt found no top-level leaf block to start from`);
	}
	return leaves;
}

async function readRange(ctx: SimContext, how: string): Promise<BuiltRange> {
	const sel = await ctx.editor.bridge.getSelectionPaths();
	if (!sel || sel.anchor.path.length !== 1 || sel.focus.path.length !== 1) {
		throw new Error(
			`[${ctx.label}] range-interrupt build (${how}) needs both endpoints at top level, got ` +
				JSON.stringify(sel)
		);
	}
	return sel;
}

// ── Gesture acts ────────────────────────────────────────────────────────────

async function editorBox(ctx: SimContext): Promise<{ left: number; right: number }> {
	return ctx.page.evaluate(() => {
		const r = (document.querySelector('.editor') as HTMLElement).getBoundingClientRect();
		return { left: r.left, right: r.right };
	});
}

async function clickBelowLastBlock(ctx: SimContext): Promise<undefined> {
	const root = await editorBox(ctx);
	const bottom = await ctx.page.evaluate(() => {
		const blocks = document.querySelectorAll('[data-block-path]:not([data-block-path*=","])');
		return (blocks[blocks.length - 1] as HTMLElement).getBoundingClientRect().bottom;
	});
	await ctx.page.mouse.click(root.left + 40, bottom + 30);
	return undefined;
}

async function clickInRightMargin(ctx: SimContext): Promise<undefined> {
	const root = await editorBox(ctx);
	const top = await ctx.page.evaluate(() => {
		const block = document.querySelector('[data-block-path]:not([data-block-path*=","])');
		return (block as HTMLElement).getBoundingClientRect().top;
	});
	await ctx.page.mouse.click(root.right - 5, top + 6);
	return undefined;
}

async function clickImageWidget(ctx: SimContext): Promise<number> {
	const widget = ctx.page.locator('[data-image-widget]').first();
	await widget.click();
	const index = await ctx.page.evaluate(() => {
		const host = document
			.querySelector('[data-image-widget]')
			?.closest('[data-block-path]:not([data-block-path*=","])');
		return JSON.parse(host?.getAttribute('data-block-path') ?? '[-1]')[0] as number;
	});
	if (index < 0) throw new Error(`[${ctx.label}] the image widget has no top-level block host`);
	return index;
}

/**
 * Press the reorder grip and release without moving. The handle only paints on hover,
 * so the press is preceded by one — a real user's sequence, and the only way to reach
 * the element at all.
 */
async function pressDragHandle(ctx: SimContext): Promise<undefined> {
	const host = ctx.page.locator('[data-block-path]:not([data-block-path*=","])').first();
	await host.hover();
	await ctx.editor.waitForRenderFlush();
	const box = await host.locator('.block-drag-handle').first().boundingBox();
	if (!box) throw new Error(`[${ctx.label}] the reorder grip did not paint on hover`);
	await ctx.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await ctx.page.mouse.down();
	await ctx.page.mouse.up();
	return undefined;
}

async function pressEscape(ctx: SimContext): Promise<undefined> {
	await ctx.page.keyboard.press('Escape');
	return undefined;
}

/**
 * Open the find bar, run a query, navigate, and close it. Focus leaves the document
 * for the input and comes back on Escape, so this is the one gesture in the family
 * that takes the caret out of the editor entirely and hands it back.
 */
async function searchRoundTrip(ctx: SimContext): Promise<undefined> {
	await ctx.page.keyboard.press(`${primaryModifier}+f`);
	const input = ctx.page.locator('.search-bar input').first();
	await input.waitFor({ state: 'visible' });
	await input.click();
	await ctx.page.keyboard.type('e');
	await ctx.page.keyboard.press('Enter');
	await ctx.editor.waitForRenderFlush();
	await ctx.page.keyboard.press('Escape');
	await input.waitFor({ state: 'detached' });
	return undefined;
}

/**
 * Click the rendered inline math island to reveal its `$…$` source. Aims at the
 * painted `.katex-html` glyphs rather than the island center, where the clipped
 * `.katex-mathml` half degenerates a center click to a corner outside the hit-test
 * (the same trap `gestures/math.ts` documents).
 */
async function clickInlineMathWidget(ctx: SimContext): Promise<undefined> {
	const widget = ctx.page.locator('.math-inline-widget').first();
	const glyphs = widget.locator('.katex-html');
	const target = (await glyphs.count()) > 0 ? glyphs.first() : widget;
	const box = await target.boundingBox();
	if (!box) throw new Error(`[${ctx.label}] the inline math island has no bounding box`);
	await target.click({ position: { x: box.width / 2, y: box.height / 2 } });
	await ctx.page.locator('.math-inline-widget').first().waitFor({ state: 'detached' });
	return undefined;
}

async function clickTocEntry(ctx: SimContext): Promise<undefined> {
	await ctx.page.locator('.toc-block-item').first().click();
	await ctx.editor.waitForRenderFlush();
	return undefined;
}

// ── Oracles ─────────────────────────────────────────────────────────────────

/**
 * The pinned contract, checked BEFORE the keystroke so a failure names the stranded
 * range rather than showing a wiped document and leaving the reader to infer why. A
 * range-keeping gesture must leave the endpoints byte-identical; every other gesture
 * must have ended the range outright.
 */
async function assertRangeContract(
	ctx: SimContext,
	gesture: RangeInterruptGesture,
	consumes: Consumes,
	built: BuiltRange
): Promise<void> {
	const live = await ctx.editor.bridge.isCrossBlockActive();
	if (consumes === 'range') {
		const now = await ctx.editor.bridge.getSelectionPaths();
		if (!live || JSON.stringify(now) !== JSON.stringify(built)) {
			throw new Error(
				`[${ctx.label}] ${gesture} was expected to leave the range untouched.\n` +
					`BUILT: ${JSON.stringify(built)}\nNOW:   ${JSON.stringify(now)} (cross-block=${live})`
			);
		}
		return;
	}
	if (live) {
		throw new Error(
			`[${ctx.label}] ${gesture} placed the keystroke's target but left the cross-block range ` +
				`live — the next printable key type-replaces the whole of it.\n` +
				`RANGE: ${JSON.stringify(built)}\n` +
				`NOW:   ${JSON.stringify(await ctx.editor.bridge.getSelectionPaths())}`
		);
	}
}

async function assertRevealEphemeral(
	ctx: SimContext,
	gesture: RangeInterruptGesture,
	before: string
): Promise<void> {
	await ctx.editor.waitForNoSourceMutation();
	const now = await ctx.editor.bridge.getSource();
	if (now !== before) {
		throw new Error(
			`[${ctx.label}] ${gesture}'s revealed edit committed before the escape.\n` +
				`EXPECTED (ephemeral): ${JSON.stringify(before)}\nACTUAL: ${JSON.stringify(now)}`
		);
	}
}

/** Walk the caret out of the reveal, which is what commits it. */
async function commitReveal(ctx: SimContext, before: string): Promise<void> {
	for (let i = 0; i < 40; i++) {
		await ctx.page.keyboard.press('ArrowRight');
		if ((await ctx.editor.bridge.getSource()) !== before) return;
	}
	throw new Error(`[${ctx.label}] the revealed source never committed on a caret escape`);
}

/**
 * A caret that landed inside a container addresses its leaf's raw, a space the
 * top-level spans cannot convert; the exact prediction there is the single-char
 * insertion itself, pinned to the block the caret is in. `probeChar` picks a
 * character absent from the source, so the insertion index is unique.
 */
function assertInsertionInsideBlock(
	ctx: SimContext,
	gesture: RangeInterruptGesture,
	before: string,
	after: string,
	span: BlockSpan
): void {
	let at = 0;
	while (at < before.length && before[at] === after[at]) at++;
	if (at < span.start || at > span.end) {
		throw new Error(
			`[${ctx.label}] ${gesture} typed into a block the caret was not in: byte ${at} is ` +
				`outside ${JSON.stringify(span)}`
		);
	}
}

// ── Predictions ─────────────────────────────────────────────────────────────

interface BlockSpan {
	start: number;
	end: number;
}

interface PredictArgs {
	ctx: SimContext;
	gesture: RangeInterruptGesture;
	spec: GestureSpec;
	before: string;
	char: string;
	range: BuiltRange;
	spans: BlockSpan[];
	landing: BuiltRange | null;
	consumedBlock: number | undefined;
}

function predict(args: PredictArgs): string {
	const { ctx, gesture, spec, before, char, range, spans, landing, consumedBlock } = args;
	switch (spec.consumes) {
		case 'range': {
			const a = absolute(spans, range.anchor);
			const b = absolute(spans, range.focus);
			return splice(before, Math.min(a, b), Math.max(a, b), char);
		}
		case 'block': {
			const span = spans[consumedBlock!];
			// The block's trailing newline is separator, not content: replacing the block
			// keeps the document's line structure.
			const end = span.end - (before.slice(span.start, span.end).match(/\n+$/)?.[0].length ?? 0);
			return splice(before, span.start, end, char);
		}
		default: {
			if (!landing) throw new Error(`[${ctx.label}] ${gesture} left no selection to type into`);
			// A nested landing has no top-level offset; assertInsertionInsideBlock carries
			// the exact check there, and this fitted prediction keeps the settle honest.
			if (landing.focus.path.length > 1) {
				const at = spans[landing.focus.path[0]].start;
				return splice(before, at, at, char);
			}
			const at = absolute(spans, landing.focus);
			return splice(before, at, at, char);
		}
	}
}

function splice(source: string, start: number, end: number, char: string): string {
	return source.slice(0, start) + char + source.slice(end);
}

function absolute(spans: BlockSpan[], point: RangePoint): number {
	return spans[point.path[0]].start + point.offset;
}

/**
 * Top-level block byte spans over the live source. `serialize` is
 * `prefix + Σ(leadingTrivia + raw) + suffix`, so the walk is the serializer's own
 * arithmetic; the reconstruction check fails loud if that ever stops being true
 * rather than letting every prediction drift by the same offset.
 */
async function topLevelSpans(ctx: SimContext): Promise<BlockSpan[]> {
	const { spans, rebuilt, source } = await ctx.page.evaluate(() => {
		const probe = (window as any).__test;
		const doc = probe.getDocument();
		const children = doc.children as { leadingTrivia: string; raw: string }[];
		let at = (doc.prefix as string).length;
		const spans = children.map((c) => {
			at += c.leadingTrivia.length;
			const start = at;
			at += c.raw.length;
			return { start, end: at };
		});
		return {
			spans,
			rebuilt: doc.prefix + children.map((c) => c.leadingTrivia + c.raw).join('') + doc.suffix,
			source: probe.getSource() as string
		};
	});
	if (rebuilt !== source) {
		throw new Error(
			`[${ctx.label}] top-level block spans do not reconstruct the source; the byte ` +
				`predictions below it would all be wrong.\nSOURCE: ${JSON.stringify(source)}`
		);
	}
	return spans;
}

/**
 * A printable character absent from the source, so the one insertion it makes has a
 * unique index and the diff-derived checks cannot latch onto a coincidence. A letter,
 * so it can never open a markdown construct at column 0.
 */
function probeChar(source: string): string {
	for (const ch of 'QZJXKVWY') {
		if (!source.includes(ch)) return ch;
	}
	return 'Q';
}
