import type { Gestures } from '../gestures';
import { clickInlineWidget, escapeRevealToCommit } from './math';
import {
	type SimContext,
	assertParseConvergence,
	assertStructuralIntegrity,
	settleTypedSource
} from '../invariants';

/**
 * A live cross-block range, a gesture that interrupts it, then one printable key: the behaviour
 * the G2.12 source scan checks statically. Each gesture is held to one observed outcome, compared
 * byte for byte, and each range is built so corruption lands far from the prediction.
 */

export type RangeInterruptGesture =
	| 'dead-space-below'
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
 * What the one printable key is predicted to replace. The two cases where a source is shown
 * differ only in what commits it: stepping the caret out for inline, a blur for a block.
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
	'dead-space-margin': { consumes: 'caret', build: 'select-all', act: clickInRightMargin },
	// The public call that reaches the same position: with no press and nothing to click, it
	// gets to the code that ends the range by its own route.
	'place-caret-at-point': { consumes: 'caret', build: 'select-all', act: placeCaretBelowDocument },
	'image-click': { consumes: 'block', build: 'select-all', act: clickImageWidget },
	'drag-handle-press': { consumes: 'range', build: 'prose-range', act: pressDragHandle },
	// The one gesture here that leaves a caret on a prose range: Escape collapses to where the
	// selection started, which sits inside the text, so it is a steady position to check.
	escape: { consumes: 'caret', build: 'prose-range', act: pressEscape },
	'search-round-trip': { consumes: 'range', build: 'prose-range', act: searchRoundTrip },
	// Only the second one ever cost a whole document: clicking an inline widget passes through
	// the cross-block handler, which resets on the way, while a block that only renders has no
	// source text to click into and has to end the range itself.
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
	// Navigating lands at offset 0 of the target heading, which demotes it, so the document
	// needs a blank line there. That requirement is stated on the fixture that provides it.
	'toc-entry-click': { consumes: 'caret', build: 'select-all', act: clickTocEntry },
	// The one position outside any block: the key creates a block rather than typing into one,
	// so the boundary is read from the gap probe, not from `getSelectionPaths`.
	'gap-caret-click': { consumes: 'gap-mint', build: 'select-all', act: clickAboveLeadingBlock }
};

/**
 * The gesture itself must move no bytes; one that does is a finding, not something to accept.
 * Undoes back to the start, so the session's end state still matches.
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

	if (spec.consumes === 'reveal-escape' || spec.consumes === 'reveal-blur') {
		// A block showing its source takes the character into the DOM without committing it, so
		// the editor's recorded decision about the key orders the byte check below.
		await ctx.editor.typeDeclined(char);
		await assertRevealEphemeral(ctx, gesture, before);
		if (spec.consumes === 'reveal-blur') await commitRevealByBlur(ctx, before, landing);
		else await escapeRevealToCommit(ctx, before);
	} else {
		await ctx.editor.typeSlowly(char);
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
 * A fixed order, so what a seed picks can be replayed. Read from the live tree rather than
 * listed per note, so a fixture that gains an image gains the image gesture with it.
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
	// Only object blocks carry a drag handle, so a document of prose has none to press.
	const hasHandle = (await ctx.page.locator(HANDLE_HOST).count()) > 0;
	const available: RangeInterruptGesture[] = ['dead-space-margin', 'escape'];
	if (hasHandle) available.push('drag-handle-press');
	// A click below the document resolves to the last block, so a caret lands only if that block
	// has a character position: a thematic break has none, nor does a paragraph holding only an
	// image.
	if (PROSE_KINDS.has(shape.lastKind) && !shape.lastRaw.trimStart().startsWith('![')) {
		available.push('dead-space-below');
	}
	// The prediction replaces the whole block, which is what the editor does only when the image
	// is all the block holds. An image inside prose is left out rather than guessed at.
	if (imageOnlyBlock >= 0) available.push('image-click');
	available.push('search-round-trip');
	return available;
}

/** Runs in the page through `page.evaluate`, so it must use no values from outside itself. */
function findImageOnlyBlock(): number {
	const children = (window as any).__test.getDocument().children as { raw: string }[];
	return children.findIndex((c) => /^!\[[^\]]*\]\([^)]*\)$/.test(c.raw.trim()));
}

const PROSE_KINDS = new Set(['paragraph', 'heading', 'setextHeading']);
const RANGE_LEAF_KINDS = new Set(['paragraph', 'heading']);

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
 * Ctrl+A twice needs a caret to start from, and a prose block is the one kind that cannot open
 * a source view under it.
 */
async function buildSelectAll(ctx: SimContext, g: Gestures): Promise<BuiltRange> {
	const leaves = await topLevelLeaves(ctx);
	await ctx.editor.focusBlockAtPath([leaves[0]], 1);
	await g.selectWholeDocument();
	return readRange(ctx, 'select-all');
}

/**
 * With both ends past their markers, the collapse is a plain cut and join of bytes, which is
 * what lets the `range` prediction be exact without modelling the merge rules.
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
 * Filtering by kind matters three times over: a block that renders would open its source
 * instead of anchoring a range, a fenced block's markers or a setext underline make the collapse
 * more than a cut and join, and a blur that commits one source view must not open another.
 * Filtering only on "has no children and is long enough" would let `$$x^2$$` through all three.
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
		[...RANGE_LEAF_KINDS]
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

async function editorBox(
	ctx: SimContext
): Promise<{ left: number; right: number; bottom: number }> {
	return ctx.page.evaluate(() => {
		const r = (document.querySelector('.editor') as HTMLElement).getBoundingClientRect();
		return { left: r.left, right: r.right, bottom: r.bottom };
	});
}

async function clickBelowLastBlock(ctx: SimContext): Promise<undefined> {
	const root = await editorBox(ctx);
	await ctx.page.mouse.click(root.left + 40, await belowDocumentY(ctx));
	return undefined;
}

/** The strip just under the last block belongs to the trailing insert row, where a click adds
 *  a paragraph, so the empty space these gestures aim at starts below that, inside the editor. */
async function belowDocumentY(ctx: SimContext): Promise<number> {
	const root = await editorBox(ctx);
	const tail = await ctx.page.locator('.editor-tail').boundingBox();
	const bottom = tail ? tail.y + tail.height : (await lastBlockBottom(ctx)) + 22;
	return Math.min(bottom + 8, root.bottom - 4);
}

/**
 * The public `placeCaretAtPoint`, called the way an app with its own UI below the document
 * calls it. Called directly on purpose: the API itself is what is under test here, not a
 * shortcut around a gesture, and a false answer means it placed no caret to type into.
 */
async function placeCaretBelowDocument(ctx: SimContext): Promise<undefined> {
	const root = await editorBox(ctx);
	const point = { x: root.left + 40, y: await belowDocumentY(ctx) };
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
 * Aimed at prose rather than at whatever happens to be first: the click resolves to that block
 * and so lands at the top level, which is where every prediction here counts offsets.
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

/** The drag handle only appears on hover, so the press has to follow one; a paragraph has no
 *  handle, so the first top-level block that does is the one used. */
const HANDLE_HOST = '[data-block-path]:not([data-block-path*=","]):has(> .block-drag-handle)';

async function pressDragHandle(ctx: SimContext): Promise<undefined> {
	const host = ctx.page.locator(HANDLE_HOST).first();
	await host.hover();
	await ctx.editor.waitForRenderFlush();
	const box = await host.locator('.block-drag-handle').first().boundingBox();
	if (!box) throw new Error(`[${ctx.label}] the reorder drag handle did not paint on hover`);
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
 * The one gesture here that takes focus out of the editor and gives it back: it leaves for the
 * find field and returns on Escape.
 */
async function searchRoundTrip(ctx: SimContext): Promise<undefined> {
	await ctx.page.keyboard.press('ControlOrMeta+f');
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

/** Click the rendered inline math widget to open its `$…$` source. */
async function clickInlineMathWidget(ctx: SimContext): Promise<undefined> {
	await clickInlineWidget(ctx.page, 0);
	await ctx.page.locator('.math-inline-widget').first().waitFor({ state: 'detached' });
	return undefined;
}

/** A whole block that renders, unlike the inline widget: a different path ends the range. */
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
 * The editor's padding above the first block, when that block offers a gap before it. The
 * clickable strips for the blocks lie edge to edge, so this padding is the only place a pointer
 * can reach that belongs to none of them, which makes the start of the document the one gap
 * these gestures can reach by clicking.
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

// ── Checks ──────────────────────────────────────────────────────────────────

/**
 * Checked before the keystroke, so a failure names the range that was left behind instead of
 * showing a wiped document. A gesture that keeps the range must leave both ends exactly as
 * they were.
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
			`[${ctx.label}] ${gesture} placed the keystroke's target but left the cross-block range live:` +
				` the next printable key type-replaces the whole of it.
` +
				`RANGE: ${JSON.stringify(built)}
` +
				`NOW:   ${JSON.stringify(await ctx.editor.bridge.getSelectionPaths())}`
		);
	}
}

/**
 * The gap's own probe, since `getSelectionPaths` reports null while the caret sits in a gap.
 * Anything but a top-level boundary within the table of block spans means the click went into
 * a block instead, and the prediction below would name a boundary the caret is not at.
 */
async function requireGapLanding(
	ctx: SimContext,
	gesture: RangeInterruptGesture,
	spanCount: number
): Promise<number> {
	const gap = await ctx.editor.bridge.getGapCaret();
	if (!gap || gap.parentPath.length > 0 || gap.index >= spanCount) {
		throw new Error(
			`[${ctx.label}] ${gesture} was expected to put a top-level gap caret the span table ` +
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
	const now = await ctx.editor.bridge.getSource();
	if (now !== before) {
		throw new Error(
			`[${ctx.label}] ${gesture}'s revealed edit committed before the escape.\n` +
				`EXPECTED (ephemeral): ${JSON.stringify(before)}\nACTUAL: ${JSON.stringify(now)}`
		);
	}
}

/** Click another block, which is what commits the source a rendered block was showing. */
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
	/** Offset from the start of the document for a caret inside a nested block, worked out in
	 *  the page; null when the block's bytes do not sit unbroken inside its parents', and
	 *  undefined for a caret at the top level. */
	nestedCaret: number | null | undefined;
	consumedBlock: number | undefined;
	/** The top-level boundary the caret sits at in a gap, for `consumes: 'gap-mint'`. */
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
			// The newline at the end of a block separates it from the next rather than being
			// part of it, so replacing the block keeps the document's line structure.
			const end = span.end - (before.slice(span.start, span.end).match(/\n+$/)?.[0].length ?? 0);
			return splice(before, span.start, end, char);
		}
		// The three cases that end with a caret share the same arithmetic: the key goes in
		// where the gesture left the caret. A shown source only delays when those bytes
		// appear, not where.
		case 'caret':
		case 'reveal-escape':
		case 'reveal-blur': {
			if (!landing) throw new Error(`[${ctx.label}] ${gesture} left no selection to type into`);
			// Guessing an offset here would fail against a correct editor, so throw instead;
			// `nestedCaretOffset` says when the offset can be worked out at all.
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
		// A new paragraph, not text added to one: the key's own line plus the blank line GFM
		// requires between two blocks, at the first byte of the block after the gap. The
		// fixtures end lines with LF, and G4.20 gives the neighbour its own.
		case 'gap-mint': {
			if (gapBoundary === undefined) {
				throw new Error(`[${ctx.label}] ${gesture} named no gap boundary to create at`);
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
 * This walk repeats the serializer's own arithmetic, and rebuilding the source from the spans
 * throws if that stops being true, rather than letting every prediction sit one byte out.
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
 * Offset from the start of the document for a caret inside a nested block, or null when there
 * is no such offset. The descent checks itself: finding each child's raw text inside its
 * parent's works for a table, where a cell's text sits unchanged in its row, but not for a
 * blockquote, where a child's `> ` markers are stripped, and there it returns null rather than
 * a plausible wrong number.
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
 * A character the source does not already hold, so where it is inserted is unambiguous; a
 * letter, so it can never open a construct at column 0.
 */
function probeChar(source: string): string {
	for (const ch of 'QZJXKVWY') {
		if (!source.includes(ch)) return ch;
	}
	return 'Q';
}
