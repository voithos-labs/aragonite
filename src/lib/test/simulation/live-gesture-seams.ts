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
import { snapToScalarBoundary, trailingLineEnding, trimTrailingLineEnding } from '$lib/core/lines';
import { renderInlineNodes } from '$lib/core/inline-render';
import { listInlineMarks, type InlineMark } from '$lib/schema/inline-construct-policy';
import { toggleInlineFormat } from '$lib/core/inline/format-toggle';
import {
	CONTENT_EMPTY_ATTR,
	holdsOnlyMarkerChrome,
	isHiddenMarkerText
} from '$lib/cursor/widget-offset';
import { asRawOffset, type RawOffset } from '$lib/cursor/coordinate-spaces';
import { createEdgePolicyDispatch } from '$lib/components/blocks/text/edge-policy-dispatch';
import { createSurfaceWrite } from '$lib/components/blocks/surface-write';
import { keepsKindAt } from '$lib/core/inline/live-edit/read-back';
import { storedAsAt } from '$lib/tree-operations/stored-as';
import { resolveDelimiterAutoPair } from '$lib/components/blocks/text/delimiter-autopair';
import { createAutoPairRecord } from '$lib/components/blocks/text/auto-pair-record';
import { resolveLiveRangeEdit } from '$lib/components/blocks/text/live-selection-edit';
import { replaceRangeInLeaf } from '$lib/tree-operations/leaf-range';
import { rangeDelete } from '$lib/selection/range-delete';
import { blockNodeAt, nodeAt } from '$lib/tree-operations/node-primitives';
import { coverRange, rangeCoverage } from '$lib/selection/range-coverage';
import {
	applyCrossBlockFormat,
	planCrossBlockFormat
} from '$lib/selection/cross-block/format-range';
import { normalizeCharEndpoint } from '$lib/selection/char-endpoint-snap';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import {
	containerBundleOver,
	makeEditorActionsDeps,
	makeNestedHarness,
	makePendingMarks
} from '$lib/test/harness/editor-actions';
import { proseLeaves, type ProseLeaf } from './live-screen-reading';
import { fixtureReading, renderOptions } from '../harness/fixture-grammar';
import { documentBody } from '$lib/tree-operations/node-primitives';
import { createInsertionRecords } from '$lib/cursor/next-insertion';

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

/** The block's rendered DOM. Images render as their source text, the fallback with no widget
 *  registered, so every byte stays where the caret can reach it. */
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
	/** The block-edit bundle that writes the leaf at `path`: the document's, or its container's. */
	blockEditAt(path: readonly number[]): BlockEditActions;
}

function harnessFor(source: string, mode: PresentationMode | undefined): Harness {
	const { deps } = makeEditorActionsDeps(
		parse(source),
		mode ? { reading: fixtureReading({}, mode) } : {}
	);
	const controller = createUndoController(deps);
	const blockEdit = createBlockEditActions(deps, controller);
	return {
		doc: deps.doc,
		blockEdit,
		sharing: deps.sharing,
		blockEditAt: (path) =>
			path.length === 1
				? blockEdit
				: containerBundleOver(deps, controller, path.slice(0, -1)).bundle.blockEdit
	};
}

/** Shared by the draw and the applier, so a drawn offset aims at the very node the applier picks.
 *  Split and the single-block toggle stay at the top level, where their callers are. */
export function gestureTargets(doc: Document, kind: GestureKind): ProseLeaf[] {
	if (kind === 'type-in-container' || kind === 'blank-in-container') return containerLeaves(doc);
	if (spansLeaves(kind) || IN_ANY_LEAF.has(kind)) return proseLeaves(doc);
	return doc.children.flatMap((child, index) =>
		child.children === undefined && isProseKind(child.kind) ? [{ path: [index], node: child }] : []
	);
}

/** The gestures a block's own handlers take, which every prose leaf runs, a container's too. */
const IN_ANY_LEAF = new Set<GestureKind>([
	'type',
	'backspace',
	'delete',
	'type-over',
	'word-delete'
]);

/** Whether the gesture starts in a list item's first block, the one its marker stands before. */
export function startsUnderListMarker(doc: Document, gesture: Gesture): boolean {
	const targets = gestureTargets(doc, gesture.kind);
	if (targets.length === 0) return false;
	const path = spansLeaves(gesture.kind)
		? drawnLeafRange(doc, gesture)?.start.path
		: targets[gesture.leaf % targets.length].path;
	if (!path || path.length < 2 || path[path.length - 1] !== 0) return false;
	return nodeAt(doc, path.slice(0, -1))?.kind === 'listItem';
}

/** Read before the offset reaches any editing call: a caller's own arithmetic can produce a
 *  mid-pair offset, so the harness counts it rather than quietly moving it. */
export function drawsMidScalar(doc: Document, gesture: Gesture): boolean {
	return drawnSites(doc, gesture).some(
		({ node, offset }) => snapToScalarBoundary(node.raw, offset) !== offset
	);
}

/** The offsets inside a character that takes two code units, since an even draw would meet one
 *  only by accident. Absolute offsets, like {@link hiddenEdgeOffsets}. */
export function scalarInteriors(raw: string, start: number, end: number): number[] {
	const found: number[] = [];
	for (let at = start + 1; at < end; at++) if (snapToScalarBoundary(raw, at) !== at) found.push(at);
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

/** The browser never reports an offset inside a surrogate pair, so keypresses and selections snap;
 *  the split and the range gestures take raw offsets, which production code has to catch. */
function throughDoor(node: CstNode, offset: number, kind: GestureKind): number {
	return kind === 'enter' || spansLeaves(kind) ? offset : snapToScalarBoundary(node.raw, offset);
}

const drawnOffset = (node: CstNode, gesture: Gesture, offset: number): number =>
	throughDoor(node, contentOffset(node, offset), gesture.kind);

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

/** Two writes, since the first builds the container's child spans (`schema/child-spans.ts`) and
 *  adds the sibling whose blank line the second write's fix-up moves or drops. */
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
		presentationMode: mode
	});
	const children = (): CstNode[] => h.deps.doc.children[target.path[0]].children ?? [];
	const seeded = children()[seed.path[1]];
	if (!seeded) return null;
	const ending = trailingLineEnding(seeded.raw, '\n');
	const body = trimTrailingLineEnding(seeded.raw);
	// No delimiters, so the only run the screen checks count is the drawn character's.
	const withSibling = body + ending + ending + 'seed' + ending;
	await h.bundle.blockEdit.updateBlockContent(seed.path[1], withSibling, 'authored', 0);

	const node = children()[target.path[1]];
	if (!node) return null;
	if (gesture.kind === 'blank-in-container') {
		const ending = trailingLineEnding(node.raw, '\n');
		await h.bundle.blockEdit.updateBlockContent(target.path[1], ending, 'authored', 1, 0);
	} else {
		const at = drawnOffset(node, gesture, gesture.endOffset);
		const text = node.raw.slice(0, at) + gesture.char + node.raw.slice(at);
		await h.bundle.blockEdit.updateBlockContent(
			target.path[1],
			text,
			'authored',
			at,
			at + gesture.char.length
		);
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
	const { path, node } = targets[gesture.leaf % targets.length];
	const leaf: LeafAt = { path, node, index: path[path.length - 1], blockEdit: h.blockEditAt(path) };
	const offset = drawnOffset(node, gesture, gesture.offset);
	if (gesture.kind === 'enter') {
		await h.blockEdit.splitBlock(leaf.index, offset);
		return false;
	}
	if (gesture.kind === 'type-over') return replaceSelection(h, leaf, gesture, mode);
	if (gesture.kind === 'format-toggle') return toggleFormat(leaf, gesture, mode);
	if (gesture.kind === 'word-delete') return wordDelete(h, leaf, gesture, mode);
	return pressEdgeKey(h, leaf, offset, gesture, mode);
}

/** The leaf a block gesture addresses, with the bundle that writes it. */
interface LeafAt {
	path: number[];
	index: number;
	node: CstNode;
	blockEdit: BlockEditActions;
}

/** Where the leaf keeps its bytes, in the reading the gesture ran in. */
const storeOf = (h: Harness, leaf: LeafAt, mode: PresentationMode | undefined) =>
	storedAsAt(h.doc, leaf.path, fixtureReading({}, mode));

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
	leaf: LeafAt,
	offset: number,
	gesture: Gesture,
	mode: PresentationMode | undefined
): Promise<boolean> {
	const key =
		gesture.kind === 'type' ? gesture.char : gesture.kind === 'backspace' ? 'Backspace' : 'Delete';
	const el = mountBlock(leaf.node, mode);
	const node = () => nodeAt(h.doc, leaf.path) as CstNode;
	const dispatch = createEdgePolicyDispatch({
		get node() {
			return nodeAt(h.doc, leaf.path) as CstNode;
		},
		get index() {
			return leaf.index;
		},
		get containerParent() {
			return blockNodeAt(h.doc, leaf.path.slice(0, -1));
		},
		get reading() {
			return fixtureReading();
		},
		getEl: () => el,
		storedAs: () => storeOf(h, leaf, mode),
		hasIslands: () => false,
		getRawSelection: () => null,
		// The block anchors a key's write at the caret it recorded when the key arrived.
		writeText: createSurfaceWrite({
			getNode: node,
			getIndex: () => leaf.index,
			getPath: () => leaf.path,
			blockEdit: leaf.blockEdit,
			kindCue: { afterTypedWrite: async () => {}, labelAt: () => undefined, dismiss: () => {} },
			getPreEditOffset: () => offset,
			requestCaret: () => {},
			holdInsertion: () => createInsertionRecords([]).hold({}, null)
		}),
		completeMarker: () => void leaf.blockEdit.completeMarker(leaf.index),
		setSnapTarget: () => {},
		isRevealing: () => false,
		enterWidget: () => {},
		isReading: () => false,
		getEdgeAffinity: () => gesture.affinity,
		pendingMarks: makePendingMarks(),
		ownPairs: createAutoPairRecord().forBlock()
	});
	const event = new KeyboardEvent('keydown', { key, cancelable: true });
	if (dispatch.handleKeydown(event, asRawOffset(offset) as RawOffset)) return true;
	await nativePress(h, leaf, offset, gesture.kind, key, mode);
	return false;
}

/** What the browser does with a keypress no branch took. */
async function nativePress(
	h: Harness,
	leaf: LeafAt,
	offset: number,
	kind: GestureKind,
	key: string,
	mode: PresentationMode | undefined
): Promise<void> {
	const { node, index } = leaf;
	const { start, end } = getContentRange(node);
	const write = (raw: string, caret: number) =>
		leaf.blockEdit.updateBlockContent(index, raw, 'authored', offset, caret);
	if (kind === 'type') {
		// Every typed byte goes through the delimiter auto-pair handler in every mode (G4.65); a
		// drawn document holds no pair that handler wrote.
		const paired = resolveDelimiterAutoPair(
			trimTrailingLineEnding(node.raw),
			{ start, end },
			offset,
			key,
			fixtureReading(),
			{ ownPair: null, keepsKind: (line) => keepsKindAt(node, line, storeOf(h, leaf, mode)) }
		);
		if (paired?.kind === 'step-over') return;
		if (paired) {
			await write(paired.text + trailingLineEnding(node.raw, '\n'), paired.caret);
			return;
		}
		await write(splice(node.raw, offset, offset, key), offset + key.length);
		return;
	}
	// At the start or end of the content the keypress becomes a block gesture: the merge it aims at.
	// A container's own merge rules are not modelled here, so its edge presses do nothing.
	const topLevel = leaf.path.length === 1;
	if (kind === 'backspace') {
		if (offset > start) {
			const from = snapToScalarBoundary(node.raw, offset - 1);
			await write(splice(node.raw, from, offset, ''), from);
		} else if (topLevel && index > 0) {
			await h.blockEdit.mergeWithPrevious(index);
		}
		return;
	}
	if (offset >= end) {
		if (topLevel && index < h.doc.children.length - 1) await h.blockEdit.mergeWithNext(index);
		return;
	}
	const to = offset + (snapToScalarBoundary(node.raw, offset + 1) === offset ? 2 : 1);
	await write(splice(node.raw, offset, to, ''), offset);
}

const splice = (raw: string, from: number, to: number, insert: string): string =>
	raw.slice(0, from) + insert + raw.slice(to);

/** A format chord over the drawn range, through the call both prose blocks make. A collapsed range
 *  goes to pending marks in live mode, which is a different path, so this gesture needs a span. */
function toggleFormat(
	{ node, index, blockEdit }: LeafAt,
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
			reading: fixtureReading({}, mode)
		},
		drawnMark(gesture).kind
	);
	// A toggle whose candidate the painter rejects writes nothing, which is live mode's own answer
	// rather than a gesture the fuzzer failed to apply.
	if (!toggled) return true;
	void blockEdit.updateBlockContent(
		index,
		toggled.newDisplay + trailingLineEnding(node.raw, '\n'),
		'authored',
		range.start,
		toggled.newSelStart
	);
	return true;
}

/** A chorded delete over the range the browser reports: the caret stays collapsed, so the range
 *  arrives on the beforeinput event and the block's own handler is the only code that sees it. */
function wordDelete(
	h: Harness,
	leaf: LeafAt,
	gesture: Gesture,
	mode: PresentationMode | undefined
): boolean {
	const { node, index, blockEdit } = leaf;
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
		storeOf(h, leaf, mode)
	);
	if (edit === null) {
		void blockEdit.updateBlockContent(
			index,
			splice(node.raw, range.start, range.end, ''),
			'authored',
			range.start,
			range.start
		);
		return false;
	}
	if (edit.kind === 'rewrite') {
		void blockEdit.updateBlockContent(index, edit.raw, 'authored', edit.range.start, edit.caret);
	}
	return true;
}

/** Typing over a selection inside one block: the browser's replace, re-expressed as a join of what
 *  survives on either side (live-mode.md § 4.5). A refusal leaves the browser's own splice. */
function replaceSelection(
	h: Harness,
	leaf: LeafAt,
	gesture: Gesture,
	mode: PresentationMode | undefined
): boolean {
	const { node, index, blockEdit } = leaf;
	const range = drawnRange(node, gesture);
	if (range === null) return false;
	const edit = replaceRangeInLeaf(node, range, gesture.char, storeOf(h, leaf, mode));
	if (!edit.matchesBrowserEdit) {
		void blockEdit.updateBlockContent(index, edit.raw, 'authored', range.start, edit.caret);
		return true;
	}
	const raw = splice(node.raw, range.start, range.end, gesture.char);
	void blockEdit.updateBlockContent(
		index,
		raw,
		'authored',
		range.start,
		range.start + gesture.char.length
	);
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
		rangeDelete(
			h.doc,
			rangeCoverage(h.doc, coverRange(h.doc, range.start, range.end)),
			h.sharing,
			fixtureReading({}, mode),
			'keyless'
		);
		return false;
	}
	const plan = planCrossBlockFormat(
		h.doc,
		coverRange(h.doc, range.start, range.end),
		drawnMark(gesture).kind,
		fixtureReading({}, mode)
	);
	// A toggle the planner turns down writes nothing, which is that code's own answer rather than
	// a gesture the fuzzer failed to apply.
	if (plan) applyCrossBlockFormat(documentBody(h.doc), plan, h.sharing, defaultGrammarView);
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
