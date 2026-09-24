/**
 * One drawn gesture, applied through the same code a real keystroke goes through: the caret-edge
 * dispatch over a mounted block, the block-edit bundle's split and merge, the range delete, and the
 * browser's own replace of a selection. Never a registered rewrite function directly: the code that
 * calls those is what this tests.
 */

import { defaultGrammarView } from '$lib/schema/block-openers';
import type { CstNode, Document } from '$lib/core/nodes';
import type { PresentationMode } from '$lib/presentation-mode';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import type { BlockEditActions } from '$lib/action-contracts';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { getContentRange, isProseKind, parseInline } from '$lib/core/inline';
import { trailingLineEnding, trimTrailingLineEnding } from '$lib/core/lines';
import { renderInlineNodes } from '$lib/core/inline-render';
import { listInlineMarks, type InlineMark } from '$lib/schema/inline-construct-policy';
import { toggleInlineFormat } from '$lib/core/inline/format-toggle';
import {
	CONTENT_EMPTY_ATTR,
	holdsOnlyMarkerChrome,
	isHiddenMarkerText
} from '$lib/cursor/widget-offset';
import { asRawOffset, type RawOffset } from '$lib/cursor/coordinate-spaces';
import {
	createEdgePolicyDispatch,
	keepsBlockKind
} from '$lib/components/blocks/text/edge-policy-dispatch';
import { resolveDelimiterAutoPair } from '$lib/components/blocks/text/delimiter-autopair';
import {
	resolveLiveRangeEdit,
	resolveSelectionEdit
} from '$lib/components/blocks/text/live-selection-edit';
import { rangeDelete } from '$lib/selection/range-delete';
import {
	applyCrossBlockFormat,
	planCrossBlockFormat
} from '$lib/selection/cross-block/format-range';
import { normalizeCharEndpoint } from '$lib/selection/char-endpoint-snap';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import {
	makeEditorActionsDeps,
	makeNestedHarness,
	makePendingMarks
} from '$lib/test/harness/editor-actions';
import { proseLeaves, type ProseLeaf } from './live-screen-reading';
import { fixtureLinkRef, renderOptions } from '../harness/fixture-grammar';

export type GestureKind =
	| 'type'
	| 'type-in-container'
	| 'blank-in-container'
	| 'backspace'
	| 'delete'
	| 'enter'
	| 'range-delete'
	| 'type-over'
	| 'format-toggle'
	| 'cross-format-toggle'
	| 'word-delete';

export interface Gesture {
	kind: GestureKind;
	/** An index into the leaves this gesture can reach; the applier wraps it around that list. */
	leaf: number;
	offset: number;
	endLeaf: number;
	endOffset: number;
	char: string;
	affinity: EdgeAffinity | null;
	/** An index into the kinds a format toggle can write; the toggle wraps it around that list. */
	mark: number;
}

export interface Applied {
	doc: Document;
	bytes: string;
	/** Whether a caret-edge handler took the keypress, counted to prove the sweep reached one. */
	claimed: boolean;
}

// ── The block's editable element, as much as a keystroke reads ───────────────

/** The block's rendered DOM: its leading marker span, the inline render, and the content-empty
 *  data attribute. Images render as their source text (the render path's fallback where no widget
 *  is registered), which keeps every byte in one caret space instead of behind a widget the caret
 *  cannot enter. */
function mountBlock(node: CstNode, mode: PresentationMode | undefined): HTMLElement {
	const root = document.createElement('div');
	if (mode) root.setAttribute('data-presentation', mode);
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	const range = getContentRange(node);
	const prefix = node.raw.slice(0, range.start);
	if (prefix) {
		const span = document.createElement('span');
		span.className = 'md-marker';
		span.textContent = prefix;
		el.appendChild(span);
	}
	el.appendChild(
		renderInlineNodes(parseInline(node.raw, range.start, range.end), node.raw, renderOptions())
	);
	el.toggleAttribute(CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome(el));
	root.appendChild(el);
	document.body.appendChild(root);
	placeCaretInText(el);
	return el;
}

/** A collapsed caret in painted text, which is what a real caret is: two dispatch branches read
 *  the DOM selection to tell a caret in text from one on an element. */
function placeCaretInText(el: HTMLElement): void {
	const sel = window.getSelection();
	sel?.removeAllRanges();
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (isHiddenMarkerText(node, el)) continue;
		const range = document.createRange();
		range.setStart(node, 0);
		range.collapse(true);
		sel?.addRange(range);
		return;
	}
}

export function resetSurfaces(): void {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
}

// ── The document under the gesture ───────────────────────────────────────────

interface Harness {
	doc: Document;
	blockEdit: BlockEditActions;
	sharing: ReturnType<typeof makeEditorActionsDeps>['deps']['sharing'];
}

function harnessFor(source: string, mode: PresentationMode | undefined): Harness {
	const { deps } = makeEditorActionsDeps(parse(source), mode ? { presentationMode: mode } : {});
	return {
		doc: deps.doc,
		blockEdit: createBlockEditActions(deps, createUndoController(deps)),
		sharing: deps.sharing
	};
}

/**
 * The leaves a gesture can reach. A caret-edge keypress, a split and a selection replace go through
 * the document-level action bundle, so they reach top-level prose only; a range delete takes paths,
 * so it reaches a container's children too. One function, because the draw aims its offset at the
 * very node the applier will pick.
 */
export function gestureTargets(doc: Document, kind: GestureKind): ProseLeaf[] {
	if (kind === 'type-in-container' || kind === 'blank-in-container') return containerLeaves(doc);
	if (spansLeaves(kind)) return proseLeaves(doc);
	return doc.children.flatMap((child, index) =>
		child.children === undefined && isProseKind(child.kind) ? [{ path: [index], node: child }] : []
	);
}

/** Whether a drawn offset landed inside a surrogate pair, read before the offset reaches any
 *  editing call: that is the shape a caller's own arithmetic can produce, and the one this harness
 *  must count rather than quietly move. */
export function drawsMidScalar(doc: Document, gesture: Gesture): boolean {
	return drawnSites(doc, gesture).some(
		({ node, offset }) => codePointStart(node.raw, offset) !== offset
	);
}

/** The offsets inside a character that takes two code units, since an even draw would meet one
 *  only by accident. Absolute offsets, like {@link hiddenEdgeOffsets}. */
export function scalarInteriors(raw: string, start: number, end: number): number[] {
	const found: number[] = [];
	for (let at = start + 1; at < end; at++) if (codePointStart(raw, at) !== at) found.push(at);
	return found;
}

// ── The drawn offset ─────────────────────────────────────────────────────────

/** The nodes and offsets a gesture addresses, as drawn: wrapped into the content range and
 *  nothing else. A range gesture answers with both endpoints. */
function drawnSites(doc: Document, gesture: Gesture): { node: CstNode; offset: number }[] {
	const targets = gestureTargets(doc, gesture.kind);
	if (targets.length === 0) return [];
	const start = targets[gesture.leaf % targets.length].node;
	const site = { node: start, offset: contentOffset(start, gesture.offset) };
	if (gesture.kind === 'type' || gesture.kind === 'backspace' || gesture.kind === 'delete') {
		return [site];
	}
	const end = targets[gesture.endLeaf % targets.length].node;
	return [site, { node: end, offset: contentOffset(end, gesture.endOffset) }];
}

function contentOffset(node: CstNode, offset: number): number {
	const { start, end } = getContentRange(node);
	return start + (offset % Math.max(1, end - start + 1));
}

/**
 * The drawn offset as this gesture's own entry point delivers it. A keypress and a selection come
 * from the browser, which never reports an offset inside a surrogate pair, so the harness matches
 * that. The split takes an offset a caller computed, and the range delete one the selection store
 * holds ({@link storedEndpoint}): both arrive raw, and production code is what has to catch them.
 */
function throughDoor(node: CstNode, offset: number, kind: GestureKind): number {
	return kind === 'enter' || spansLeaves(kind) ? offset : codePointStart(node.raw, offset);
}

const drawnOffset = (node: CstNode, gesture: Gesture, offset: number): number =>
	throughDoor(node, contentOffset(node, offset), gesture.kind);

/** The start of the code point `at` sits inside, which every browser-reported offset already is. */
function codePointStart(raw: string, at: number): number {
	const code = raw.charCodeAt(at);
	return code >= 0xdc00 && code <= 0xdfff ? at - 1 : at;
}

// ── The gestures ─────────────────────────────────────────────────────────────

export async function applyGesture(
	source: string,
	gesture: Gesture,
	mode: PresentationMode | undefined
): Promise<Applied | null> {
	if (gesture.kind === 'type-in-container' || gesture.kind === 'blank-in-container') {
		return writeInsideContainer(source, gesture, mode);
	}
	const h = harnessFor(source, mode);
	const claimed = spansLeaves(gesture.kind)
		? acrossLeaves(h, gesture, mode)
		: await applyBlockGesture(h, gesture, mode);
	if (claimed === null) return null;
	return { doc: h.doc, bytes: serialize(h.doc), claimed };
}

/** A container's own prose children: the leaves the document-level action bundle cannot reach. */
function containerLeaves(doc: Document): ProseLeaf[] {
	return proseLeaves(doc).filter((leaf) => leaf.path.length === 2);
}

/**
 * Writing inside a container, twice. One write cannot reach the bug class: the first write into a
 * container builds its child spans and the second uses them (`schema/child-spans.ts`). The first
 * also adds the sibling whose separating line the second write's fix-up moves, since the drawn
 * documents give a container a single line. The second write types the drawn character or empties
 * the leaf, and emptying is what makes the fix-up drop the following block's blank line.
 */
async function writeInsideContainer(
	source: string,
	gesture: Gesture,
	mode: PresentationMode | undefined
): Promise<Applied | null> {
	const doc = parse(source);
	const targets = containerLeaves(doc);
	if (targets.length === 0) return null;
	const seed = targets[gesture.leaf % targets.length];
	const target = targets[gesture.endLeaf % targets.length];
	// One container, or the first write leaves the other one's child spans unbuilt and buys nothing.
	if (seed.path[0] !== target.path[0]) return null;

	const h = makeNestedHarness(doc, {
		index: target.path[0],
		presentationMode: mode,
		stubState: true
	});
	const children = (): CstNode[] => h.deps.doc.children[target.path[0]].children ?? [];
	const seeded = children()[seed.path[1]];
	if (!seeded) return null;
	const ending = trailingLineEnding(seeded.raw);
	const body = trimTrailingLineEnding(seeded.raw);
	// No delimiters, so the only run the screen checks count is the drawn character's.
	const withSibling = body + ending + ending + 'seed' + ending;
	await h.bundle.blockEdit.updateBlockContent(seed.path[1], withSibling);

	const node = children()[target.path[1]];
	if (!node) return null;
	if (gesture.kind === 'blank-in-container') {
		const ending = trailingLineEnding(node.raw);
		await h.bundle.blockEdit.updateBlockContent(target.path[1], ending, 1, 0);
	} else {
		const at = drawnOffset(node, gesture, gesture.endOffset);
		const text = node.raw.slice(0, at) + gesture.char + node.raw.slice(at);
		await h.bundle.blockEdit.updateBlockContent(target.path[1], text, at, at + gesture.char.length);
	}
	return { doc: h.deps.doc, bytes: serialize(h.deps.doc), claimed: false };
}

async function applyBlockGesture(
	h: Harness,
	gesture: Gesture,
	mode: PresentationMode | undefined
): Promise<boolean | null> {
	const targets = gestureTargets(h.doc, gesture.kind);
	if (targets.length === 0) return null;
	const index = targets[gesture.leaf % targets.length].path[0];
	const node = h.doc.children[index];
	const offset = drawnOffset(node, gesture, gesture.offset);
	if (gesture.kind === 'enter') {
		await h.blockEdit.splitBlock(index, offset);
		return false;
	}
	if (gesture.kind === 'type-over') return replaceSelection(h, index, node, gesture, mode);
	if (gesture.kind === 'format-toggle') return toggleFormat(h, index, node, gesture, mode);
	if (gesture.kind === 'word-delete') return wordDelete(h, index, node, gesture, mode);
	return pressEdgeKey(h, index, node, offset, gesture, mode);
}

/** The mark a gesture's draw addresses; the applier and the byte check read the same pick. */
export function drawnMark(gesture: Gesture): InlineMark {
	const marks = listInlineMarks();
	return marks[gesture.mark % marks.length];
}

/** The two offsets a range gesture drew, ordered and clamped into the block's content. Null where
 *  they collapsed: every range gesture here needs a span to act on. */
function drawnRange(node: CstNode, gesture: Gesture): { start: number; end: number } | null {
	const a = drawnOffset(node, gesture, gesture.offset);
	const b = drawnOffset(node, gesture, gesture.endOffset);
	const [start, end] = a <= b ? [a, b] : [b, a];
	return start === end ? null : { start, end };
}

/** A printable key or a destructive keypress at `offset`, through the caret-edge dispatch. A press
 *  no branch takes falls back to the browser's own: its cut, or the block merge at an edge. */
async function pressEdgeKey(
	h: Harness,
	index: number,
	node: CstNode,
	offset: number,
	gesture: Gesture,
	mode: PresentationMode | undefined
): Promise<boolean> {
	const key =
		gesture.kind === 'type' ? gesture.char : gesture.kind === 'backspace' ? 'Backspace' : 'Delete';
	const el = mountBlock(node, mode);
	const dispatch = createEdgePolicyDispatch({
		grammar: defaultGrammarView,
		get node() {
			return h.doc.children[index];
		},
		get index() {
			return index;
		},
		get containerParent() {
			return null;
		},
		get linkRef() {
			return fixtureLinkRef();
		},
		getEl: () => el,
		getAmbientLength: () => 0,
		hasIslands: () => false,
		getRawSelection: () => null,
		blockEdit: h.blockEdit,
		setPendingCursor: () => {},
		setSnapTarget: () => {},
		isRevealing: () => false,
		enterWidget: () => {},
		isReading: () => false,
		getEdgeAffinity: () => gesture.affinity,
		pendingMarks: makePendingMarks(),
		installedAs: 'block'
	});
	const event = new KeyboardEvent('keydown', { key, cancelable: true });
	if (dispatch.handleKeydown(event, asRawOffset(offset) as RawOffset)) return true;
	await nativePress(h, index, node, offset, gesture.kind, key);
	return false;
}

/** What the browser does with a keypress no branch took. */
async function nativePress(
	h: Harness,
	index: number,
	node: CstNode,
	offset: number,
	kind: GestureKind,
	key: string
): Promise<void> {
	const { start, end } = getContentRange(node);
	const write = (raw: string, caret: number) =>
		h.blockEdit.updateBlockContent(index, raw, offset, caret);
	if (kind === 'type') {
		// A typed byte reaches the editable element through the auto-pair handler in every mode
		// (G4.65), so a typed delimiter writes what that handler writes: the matching closer, or
		// nothing where the caret steps over one.
		const paired = resolveDelimiterAutoPair(
			trimTrailingLineEnding(node.raw),
			{ start, end },
			offset,
			key,
			(line) => keepsBlockKind(node, line, defaultGrammarView),
			defaultGrammarView
		);
		if (paired?.kind === 'step-over') return;
		if (paired) {
			await write(paired.text + trailingLineEnding(node.raw), paired.caret);
			return;
		}
		await write(splice(node.raw, offset, offset, key), offset + key.length);
		return;
	}
	// At the start or end of the content the keypress becomes a block gesture: the merge it aims at.
	if (kind === 'backspace') {
		if (offset > start) {
			const from = codePointStart(node.raw, offset - 1);
			await write(splice(node.raw, from, offset, ''), from);
		} else if (index > 0) {
			await h.blockEdit.mergeWithPrevious(index);
		}
		return;
	}
	if (offset >= end) {
		if (index < h.doc.children.length - 1) await h.blockEdit.mergeWithNext(index);
		return;
	}
	const to = offset + (codePointStart(node.raw, offset + 1) === offset ? 2 : 1);
	await write(splice(node.raw, offset, to, ''), offset);
}

const splice = (raw: string, from: number, to: number, insert: string): string =>
	raw.slice(0, from) + insert + raw.slice(to);

/** A format chord over the drawn range, through the call both prose blocks make. A collapsed range
 *  goes to pending marks in live mode, which is a different path, so this gesture needs a span. */
function toggleFormat(
	h: Harness,
	index: number,
	node: CstNode,
	gesture: Gesture,
	mode: PresentationMode | undefined
): boolean {
	const range = drawnRange(node, gesture);
	if (range === null) return false;
	const toggled = toggleInlineFormat(
		{
			display: trimTrailingLineEnding(node.raw),
			content: getContentRange(node),
			selection: range,
			grammar: defaultGrammarView
		},
		drawnMark(gesture).kind,
		mode
	);
	// A toggle whose candidate the painter rejects writes nothing, which is live mode's own answer
	// rather than a gesture the fuzzer failed to apply.
	if (!toggled) return true;
	void h.blockEdit.updateBlockContent(
		index,
		toggled.newDisplay + trailingLineEnding(node.raw),
		range.start,
		toggled.newSelStart
	);
	return true;
}

/** A chorded delete over the range the browser reports: the caret stays collapsed, so the range
 *  arrives on the beforeinput event and the block's own handler is the only code that sees it. */
function wordDelete(
	h: Harness,
	index: number,
	node: CstNode,
	gesture: Gesture,
	mode: PresentationMode | undefined
): boolean {
	const range = drawnRange(node, gesture);
	if (range === null) return false;
	const event = new InputEvent('beforeinput', {
		inputType: 'deleteWordBackward',
		cancelable: true
	});
	Object.defineProperty(event, 'getTargetRanges', { value: () => [document.createRange()] });
	const edit = resolveLiveRangeEdit(
		event,
		node,
		{ rawRangeOf: () => range, getRawSelection: () => null },
		mode,
		fixtureLinkRef()
	);
	if (edit === null) {
		void h.blockEdit.updateBlockContent(
			index,
			splice(node.raw, range.start, range.end, ''),
			range.start,
			range.start
		);
		return false;
	}
	if (edit.kind === 'rewrite') {
		void h.blockEdit.updateBlockContent(index, edit.raw, edit.range.start, edit.caret);
	}
	return true;
}

/** Typing over a selection inside one block: the browser's replace, re-expressed as a join of what
 *  survives on either side (live-mode.md § 4.5). A refusal leaves the browser's own splice. */
function replaceSelection(
	h: Harness,
	index: number,
	node: CstNode,
	gesture: Gesture,
	mode: PresentationMode | undefined
): boolean {
	const range = drawnRange(node, gesture);
	if (range === null) return false;
	const edit = resolveSelectionEdit(node, range, gesture.char, mode, fixtureLinkRef());
	if (edit) {
		void h.blockEdit.updateBlockContent(index, edit.raw, range.start, edit.caret);
		return true;
	}
	const raw = splice(node.raw, range.start, range.end, gesture.char);
	void h.blockEdit.updateBlockContent(index, raw, range.start, range.start + gesture.char.length);
	return false;
}

/** The two gestures whose endpoints are two prose leaves, container children included. */
const spansLeaves = (kind: GestureKind): boolean =>
	kind === 'range-delete' || kind === 'cross-format-toggle';

/** A gesture over any two prose leaves, through the call its own kind commits: the delete every
 *  cross-block delete, cut and paste goes through, or the plan-then-write a format toggle does. */
function acrossLeaves(
	h: Harness,
	gesture: Gesture,
	mode: PresentationMode | undefined
): boolean | null {
	const range = drawnLeafRange(h.doc, gesture);
	if (!range) return null;
	if (gesture.kind === 'range-delete') {
		rangeDelete(h.doc, range.start, range.end, h.sharing, undefined, mode, fixtureLinkRef());
		return false;
	}
	const plan = planCrossBlockFormat(
		h.doc,
		range.start,
		range.end,
		drawnMark(gesture).kind,
		mode,
		defaultGrammarView
	);
	// A toggle the planner turns down writes nothing, which is that code's own answer rather than
	// a gesture the fuzzer failed to apply.
	if (plan) applyCrossBlockFormat(h.doc, plan, h.sharing, defaultGrammarView);
	return true;
}

/** The two endpoints as the selection store would hold them, in document order. Null where they
 *  collapsed: both gestures here need a span. */
function drawnLeafRange(
	doc: Document,
	gesture: Gesture
): { start: { path: number[]; offset: number }; end: { path: number[]; offset: number } } | null {
	const leaves = gestureTargets(doc, gesture.kind);
	if (leaves.length === 0) return null;
	const first = leaves[gesture.leaf % leaves.length];
	const second = leaves[gesture.endLeaf % leaves.length];
	const [lo, hi] = comparePaths(first.path, second.path) <= 0 ? [first, second] : [second, first];
	const a = storedEndpoint(doc, lo, hi.path, gesture.offset);
	const b = storedEndpoint(doc, hi, lo.path, gesture.endOffset);
	if (lo === hi && a === b) return null;
	const [startOffset, endOffset] = lo === hi && a > b ? [b, a] : [a, b];
	return {
		start: { path: lo.path, offset: startOffset },
		end: { path: hi.path, offset: endOffset }
	};
}

/** The offset as the selection store holds it. Every range delete in production reads its endpoints
 *  from there, so a raw offset here would test an entry point no caller comes through. */
function storedEndpoint(
	doc: Document,
	leaf: ProseLeaf,
	otherPath: readonly number[],
	offset: number
): number {
	const point = { path: leaf.path, offset: contentOffset(leaf.node, offset) };
	return normalizeCharEndpoint(doc, point, otherPath).offset;
}

function comparePaths(a: readonly number[], b: readonly number[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const diff = (a[i] ?? -1) - (b[i] ?? -1);
		if (diff !== 0) return diff;
	}
	return 0;
}
