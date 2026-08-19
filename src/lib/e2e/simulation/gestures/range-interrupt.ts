import type { Gestures } from '../gestures';
import { primaryModifier } from '../../platform';
import { clickInlineWidget, escapeRevealToCommit } from './math';
import {
	type SimContext,
	assertParseConvergence,
	assertStructuralIntegrity,
	settleTypedSource
} from '../invariants';

/**
 * The behavioral half of the pointer perimeter G2.12 pins by source inspection: a live
 * cross-block range, an interrupting gesture, then ONE printable key.
 *
 * ORACLE: each gesture is pinned to ONE outcome and asserted by byte EQUALITY, never by
 * membership in the legal pair and never read back off `isCrossBlockActive()` — both
 * self-confirm, since a neutered reset makes the corrupt output the other outcome. Each
 * `consumes` is stated from OBSERVATION, not derived from G2.12, or this suite would mirror
 * the thing it cross-checks. Builds are chosen to land corruption far from the prediction.
 */

export type RangeInterruptGesture =
	| 'dead-space-below'
	| 'dead-space-below-table'
	| 'dead-space-margin'
	| 'place-caret-at-point'
	| 'image-click'
	| 'drag-handle-press'
	| 'escape'
	| 'search-round-trip'
	| 'inline-reveal-click'
	| 'block-reveal-click'
	| 'toc-entry-click'
	| 'gap-caret-click';

/**
 * What the one printable key is predicted to consume. The two reveal rungs differ only in
 * what commits the ephemeral buffer: a caret escape for inline, a blur for a block.
 */
type Consumes = 'range' | 'caret' | 'block' | 'reveal-escape' | 'reveal-blur' | 'gap-mint';

interface GestureSpec {
	consumes: Consumes;
	build: 'select-all' | 'prose-range';
	/** Returns the top-level block index the gesture selected, for `consumes: 'block'`. */
	act(ctx: SimContext): Promise<number | undefined>;
}

const SPECS: Record<RangeInterruptGesture, GestureSpec> = {
	'dead-space-below': { consumes: 'caret', build: 'select-all', act: clickBelowLastBlock },
	// The family's one NESTED caret. The prediction reaches it because a grid's leaf bytes
	// are contiguous inside its ancestors' raw — see `predict`.
	'dead-space-below-table': { consumes: 'caret', build: 'select-all', act: clickBelowLastBlock },
	'dead-space-margin': { consumes: 'caret', build: 'select-all', act: clickInRightMargin },
	// The consumer door onto the same landing: no press and no click target in front of it,
	// so it reaches the range-ending preamble by its own route.
	'place-caret-at-point': { consumes: 'caret', build: 'select-all', act: placeCaretBelowDocument },
	'image-click': { consumes: 'block', build: 'select-all', act: clickImageWidget },
	'drag-handle-press': { consumes: 'range', build: 'prose-range', act: pressDragHandle },
	// The one caret-pinned gesture on a prose range: Escape collapses to the ANCHOR, and a
	// prose-range anchor is interior — a stable landing to assert against, no more than that
	// (a byte-0 demotion now folds inside the commit and converges).
	escape: { consumes: 'caret', build: 'prose-range', act: pressEscape },
	'search-round-trip': { consumes: 'range', build: 'prose-range', act: searchRoundTrip },
	// Only the second cost a whole-document delete: an inline island's click reaches the
	// cross-block dispatcher that resets on the way past, while a render-primary block has
	// no source text to hit-test and must call the preamble itself.
	'inline-reveal-click': {
		consumes: 'reveal-escape',
		build: 'select-all',
		act: clickInlineMathWidget
	},
	'block-reveal-click': {
		consumes: 'reveal-blur',
		build: 'select-all',
		act: clickBlockMathRender
	},
	// Navigation lands at the target heading's offset 0, which demotes it, so the document
	// owes a blank line there. That constraint is written at the fixture that owes it.
	'toc-entry-click': { consumes: 'caret', build: 'select-all', act: clickTocEntry },
	// The one landing outside the selection union: the key MINTS a block rather than
	// entering one, so the boundary is read off the gap probe, not `getSelectionPaths`.
	'gap-caret-click': { consumes: 'gap-mint', build: 'select-all', act: clickAboveLeadingBlock }
};

/**
 * The gesture itself must move NO bytes; one that does is a finding, not something to fold
 * into the baseline. Undoes back to the start so a session's end-state equality holds.
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
	const nestedCaret =
		landing && landing.focus.path.length > 1
			? await nestedCaretOffset(ctx, landing.focus)
			: undefined;
	const gapBoundary =
		spec.consumes === 'gap-mint' ? await requireGapLanding(ctx, gesture, spans.length) : undefined;
	const predicted = predict({
		ctx,
		gesture,
		spec,
		before,
		char,
		range,
		spans,
		landing,
		nestedCaret,
		consumedBlock,
		gapBoundary
	});

	await ctx.editor.typeSlowly(char);
	if (spec.consumes === 'reveal-escape' || spec.consumes === 'reveal-blur') {
		await assertRevealEphemeral(ctx, gesture, before);
		if (spec.consumes === 'reveal-blur') await commitRevealByBlur(ctx, before, landing);
		else await escapeRevealToCommit(ctx, before);
	}
	await settleTypedSource(ctx, predicted);

	await assertStructuralIntegrity(ctx);
	await assertParseConvergence(ctx);
	ctx.tracker.resync(await ctx.editor.bridge.getSource());

	await g.pause();
	await g.undo();
	await ctx.editor.bridge.waitForSourceEquals(before, 3000);
	ctx.tracker.resync(before);
}

/**
 * Fixed order so a seed's pick is replayable. Read off the LIVE tree rather than declared
 * per note, so a fixture that grows an image gains the widget probe without editing a list.
 */
export async function availableRangeInterrupts(ctx: SimContext): Promise<RangeInterruptGesture[]> {
	const [shape, imageOnlyBlock] = await Promise.all([
		ctx.page.evaluate(() => {
			const children = (window as any).__test.getDocument().children as {
				kind: string;
				raw: string;
			}[];
			const last = children[children.length - 1];
			return { lastKind: last?.kind ?? '', lastRaw: last?.raw ?? '' };
		}),
		ctx.page.evaluate(findImageOnlyBlock)
	]);
	const available: RangeInterruptGesture[] = ['dead-space-margin', 'drag-handle-press', 'escape'];
	// The band below clamps onto the last block, so a caret lands only if that block offers
	// a character position — a rule has none, and an image-only paragraph's child is a widget.
	if (PROSE_KINDS.has(shape.lastKind) && !shape.lastRaw.trimStart().startsWith('![')) {
		available.push('dead-space-below');
	}
	// The prediction replaces the host block WHOLE, which is only what the editor does when
	// the image is its entire content. Mid-prose images are not offered rather than guessed.
	if (imageOnlyBlock >= 0) available.push('image-click');
	available.push('search-round-trip');
	return available;
}

/** Runs IN THE PAGE via `page.evaluate`, so it must close over nothing. */
function findImageOnlyBlock(): number {
	const children = (window as any).__test.getDocument().children as { raw: string }[];
	return children.findIndex((c) => /^!\[[^\]]*\]\([^)]*\)$/.test(c.raw.trim()));
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
 * The double Ctrl+A needs a caret to escalate FROM, and a prose leaf is the one block that
 * cannot reveal a render-primary source under it.
 */
async function buildSelectAll(ctx: SimContext, g: Gestures): Promise<BuiltRange> {
	const leaves = await topLevelLeaves(ctx);
	await ctx.editor.focusBlockAtPath([leaves[0]], 1);
	await g.selectWholeDocument();
	return readRange(ctx, 'select-all');
}

/**
 * Endpoints past their markers keep the collapse a pure byte splice, which is what lets the
 * `range` prediction be exact without modelling merge rules.
 */
async function buildProseRange(ctx: SimContext, g: Gestures): Promise<BuiltRange> {
	const leaves = await topLevelLeaves(ctx);
	if (leaves.length < 2) {
		throw new Error(`[${ctx.label}] range-interrupt needs two top-level prose leaves to span`);
	}
	await ctx.editor.focusBlockAtPath([leaves[0]], 2);
	await g.shiftClickAcross([leaves[1]], 2);
	return readRange(ctx, 'prose-range');
}

/**
 * The KIND filter is load-bearing three times over, not decoration: a render-primary leaf
 * reveals its source instead of anchoring a range, a fenced leaf's markers make the collapse
 * something other than a byte splice, and a reveal-committing blur must not open a second
 * reveal. A childless-and-long-enough filter alone would admit `$$x^2$$` to all three.
 */
async function topLevelLeaves(ctx: SimContext): Promise<number[]> {
	const leaves = await ctx.page.evaluate(
		(prose) => {
			const children = (window as any).__test.getDocument().children as {
				kind: string;
				raw: string;
				children?: unknown[];
			}[];
			const out: number[] = [];
			children.forEach((c, i) => {
				const isLeaf = !Array.isArray(c.children) || c.children.length === 0;
				if (isLeaf && prose.includes(c.kind) && c.raw.trim().length >= 6) out.push(i);
			});
			return out;
		},
		[...PROSE_KINDS]
	);
	if (leaves.length === 0) {
		throw new Error(`[${ctx.label}] range-interrupt found no top-level prose leaf to start from`);
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
	await ctx.page.mouse.click(root.left + 40, (await lastBlockBottom(ctx)) + 30);
	return undefined;
}

/**
 * The public `placeCaretAtPoint`, called as a host shell owning chrome below the document
 * calls it. A programmatic call on purpose: the API is the door under test, not a shortcut
 * around a gesture, and a false answer means it placed nothing to type into.
 */
async function placeCaretBelowDocument(ctx: SimContext): Promise<undefined> {
	const root = await editorBox(ctx);
	const point = { x: root.left + 40, y: (await lastBlockBottom(ctx)) + 30 };
	const placed = await ctx.page.evaluate(
		(p) => (window as any).__test.placeCaretAtPoint(p.x, p.y) as boolean,
		point
	);
	if (!placed) {
		throw new Error(`[${ctx.label}] placeCaretAtPoint declined the point below the document`);
	}
	return undefined;
}

async function lastBlockBottom(ctx: SimContext): Promise<number> {
	return ctx.page.evaluate(() => {
		const blocks = document.querySelectorAll('[data-block-path]:not([data-block-path*=","])');
		return (blocks[blocks.length - 1] as HTMLElement).getBoundingClientRect().bottom;
	});
}

/**
 * Aimed at PROSE rather than at whatever sits first: the band clamp resolves to that block,
 * keeping the landing top-level — the coordinate space every prediction here works in.
 */
async function clickInRightMargin(ctx: SimContext): Promise<undefined> {
	const root = await editorBox(ctx);
	const index = (await topLevelLeaves(ctx))[0];
	const top = await ctx.page.evaluate((i) => {
		const block = document.querySelector(`[data-block-path='${JSON.stringify([i])}']`);
		if (!block) throw new Error(`no block host at index ${i}`);
		return block.getBoundingClientRect().top;
	}, index);
	await ctx.page.mouse.click(root.right - 5, top + 6);
	return undefined;
}

/** Reports the block the click selects, which is the unit the keystroke then replaces. */
async function clickImageWidget(ctx: SimContext): Promise<number> {
	const index = await ctx.page.evaluate(findImageOnlyBlock);
	if (index < 0) throw new Error(`[${ctx.label}] no image-only block for the widget click`);
	const widget = ctx.page
		.locator(`[data-block-path='${JSON.stringify([index])}']`)
		.locator('[data-image-widget]')
		.first();
	await widget.click();
	return index;
}

/** The handle only paints on hover, so the press must be preceded by one. */
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
 * The one gesture in the family that takes the caret out of the editor entirely and hands
 * it back: focus leaves for the find input and returns on Escape.
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

/** Click the rendered inline math island to reveal its `$…$` source. */
async function clickInlineMathWidget(ctx: SimContext): Promise<undefined> {
	await clickInlineWidget(ctx.page, 0);
	await ctx.page.locator('.math-inline-widget').first().waitFor({ state: 'detached' });
	return undefined;
}

/** A whole-block render-primary view, unlike the inline island: the door owning the reset. */
async function clickBlockMathRender(ctx: SimContext): Promise<undefined> {
	await ctx.page.locator('.math-block-render').first().click();
	await ctx.page.locator('.math-block-source').first().waitFor({ state: 'visible' });
	return undefined;
}

async function clickTocEntry(ctx: SimContext): Promise<undefined> {
	await ctx.page.locator('.toc-block-item').first().click();
	await ctx.editor.waitForRenderFlush();
	return undefined;
}

/**
 * The editor's leading padding above a gap-declaring first block. Root bands tile flush, so
 * that strip is the only band-less y a pointer can reach, which makes the document's start
 * the one gap boundary this family can arrive at by click.
 */
async function clickAboveLeadingBlock(ctx: SimContext): Promise<undefined> {
	const point = await ctx.page.evaluate(() => {
		const root = document.querySelector('.editor')!.getBoundingClientRect();
		const first = document.querySelector("[data-block-path='[0]']")!.getBoundingClientRect();
		return { x: first.left + 8, y: (root.top + first.top) / 2 };
	});
	await ctx.page.mouse.click(point.x, point.y);
	return undefined;
}

// ── Oracles ─────────────────────────────────────────────────────────────────

/**
 * Checked BEFORE the keystroke so a failure names the stranded range rather than showing a
 * wiped document. Range-keeping gestures must leave the endpoints byte-identical.
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

/**
 * The gap's own probe, because `getSelectionPaths` reports null while a gap is live. Anything
 * but a top-level boundary inside the span table means the click entered a block instead, and
 * the prediction below would name a boundary nothing is parked at.
 */
async function requireGapLanding(
	ctx: SimContext,
	gesture: RangeInterruptGesture,
	spanCount: number
): Promise<number> {
	const gap = await ctx.editor.bridge.getGapCaret();
	if (!gap || gap.parentPath.length > 0 || gap.index >= spanCount) {
		throw new Error(
			`[${ctx.label}] ${gesture} was expected to park a top-level gap caret the span table ` +
				`covers, got ${JSON.stringify(gap)} over ${spanCount} blocks.`
		);
	}
	return gap.index;
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

/** Click a sibling leaf, which is what commits a render-primary block's reveal. */
async function commitRevealByBlur(
	ctx: SimContext,
	before: string,
	landing: BuiltRange | null
): Promise<void> {
	const revealed = landing?.focus.path[0] ?? -1;
	const target = (await topLevelLeaves(ctx)).find((i) => i !== revealed);
	if (target === undefined) {
		throw new Error(`[${ctx.label}] no sibling leaf to blur onto, so the reveal cannot commit`);
	}
	await ctx.editor.clickBlock(target);
	await ctx.editor.bridge.waitForSourceWith((source, prior) => source !== prior, before);
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
	/** Absolute offset of a NESTED caret landing, resolved in the page; null when the
	 *  leaf's bytes are not contiguous in its ancestors', undefined for a top-level one. */
	nestedCaret: number | null | undefined;
	consumedBlock: number | undefined;
	/** Top-level boundary index a gap landing parked at, for `consumes: 'gap-mint'`. */
	gapBoundary: number | undefined;
}

function predict(args: PredictArgs): string {
	const {
		ctx,
		gesture,
		spec,
		before,
		char,
		range,
		spans,
		landing,
		nestedCaret,
		consumedBlock,
		gapBoundary
	} = args;
	switch (spec.consumes) {
		case 'range': {
			const a = absolute(spans, range.anchor);
			const b = absolute(spans, range.focus);
			return splice(before, Math.min(a, b), Math.max(a, b), char);
		}
		case 'block': {
			if (consumedBlock === undefined) {
				throw new Error(
					`[${ctx.label}] ${gesture} is pinned to a whole-block outcome but its act named ` +
						`no block, so there is nothing to predict the key replacing.`
				);
			}
			const span = spans[consumedBlock];
			// The block's trailing newline is separator, not content: replacing the block
			// keeps the document's line structure.
			const end = span.end - (before.slice(span.start, span.end).match(/\n+$/)?.[0].length ?? 0);
			return splice(before, span.start, end, char);
		}
		// The three range-ended landings share one arithmetic: the key goes in at the caret
		// the gesture left. A reveal only defers WHEN those bytes appear, not where.
		case 'caret':
		case 'reveal-escape':
		case 'reveal-blur': {
			if (!landing) throw new Error(`[${ctx.label}] ${gesture} left no selection to type into`);
			// Guessing past a null offset would red on a correct editor, so fail loud instead —
			// see `nestedCaretOffset` for when the conversion exists at all.
			if (landing.focus.path.length > 1 && nestedCaret == null) {
				throw new Error(
					`[${ctx.label}] ${gesture} landed the caret inside a container whose bytes are ` +
						`not contiguous in its ancestors' raw (${JSON.stringify(landing.focus.path)}); ` +
						`this family cannot predict that landing, so its target needs re-choosing.`
				);
			}
			const at = nestedCaret ?? absolute(spans, landing.focus);
			return splice(before, at, at, char);
		}
		// A minted paragraph, not an insertion into one: the key's own line plus the blank
		// line GFM owes between two blocks, at the first byte of the block the gap precedes.
		// LF is the fixture's line ending, and G4.20 mints the neighbour's.
		case 'gap-mint': {
			if (gapBoundary === undefined) {
				throw new Error(`[${ctx.label}] ${gesture} named no gap boundary to mint at`);
			}
			const at = spans[gapBoundary].start;
			return splice(before, at, at, `${char}\n\n`);
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
 * The walk reproduces the serializer's own arithmetic, and the reconstruction check fails
 * loud if that stops being true rather than letting every prediction drift by one offset.
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
 * Absolute offset of a NESTED caret, or null when no conversion exists. The descent IS the
 * verification: locating each child's raw inside its parent's resolves a grid (a cell's raw
 * sits verbatim in its row's) but not a strip container (a blockquote child's `> ` markers
 * are stripped), where the walk reports null rather than a plausible wrong number.
 */
async function nestedCaretOffset(ctx: SimContext, point: RangePoint): Promise<number | null> {
	return ctx.page.evaluate((pt) => {
		const doc = (window as any).__test.getDocument();
		type Node = { leadingTrivia?: string; raw: string; children?: Node[] };
		const children = doc.children as Node[];
		let at = (doc.prefix as string).length;
		for (let i = 0; i < pt.path[0]; i++) {
			at += (children[i].leadingTrivia ?? '').length + children[i].raw.length;
		}
		let node = children[pt.path[0]];
		if (!node) return null;
		at += (node.leadingTrivia ?? '').length;

		for (let depth = 1; depth < pt.path.length; depth++) {
			const kids = node.children;
			if (!kids) return null;
			let cursor = 0;
			for (let i = 0; i < pt.path[depth]; i++) {
				const found = node.raw.indexOf(kids[i].raw, cursor);
				if (found < 0) return null;
				cursor = found + kids[i].raw.length;
			}
			const child = kids[pt.path[depth]];
			if (!child) return null;
			const found = node.raw.indexOf(child.raw, cursor);
			if (found < 0) return null;
			at += found;
			node = child;
		}
		return at + pt.offset;
	}, point);
}

/**
 * Absent from the source, so its insertion has a unique index no diff-derived check can
 * latch onto by coincidence; a letter, so it can never open a construct at column 0.
 */
function probeChar(source: string): string {
	for (const ch of 'QZJXKVWY') {
		if (!source.includes(ch)) return ch;
	}
	return 'Q';
}
