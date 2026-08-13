/**
 * One drawn gesture, applied through the seams a keystroke actually crosses: the caret-edge
 * dispatch over a mounted block, the block-edit bundle's split and merge, the range-delete seam,
 * and the native selection replace. Never a rewrite slot directly — the slot readers are the point.
 */

import type { CstNode, Document } from '$lib/core/nodes';
import type { PresentationMode } from '$lib/presentation-mode';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import type { BlockEditActions } from '$lib/action-contracts';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { getContentRange, isProseKind, parseInline } from '$lib/core/inline';
import { renderInlineNodes } from '$lib/core/inline-render';
import {
	CONTENT_EMPTY_ATTR,
	holdsOnlyMarkerChrome,
	isHiddenMarkerText
} from '$lib/cursor/widget-offset';
import { asRawOffset, type RawOffset } from '$lib/cursor/coordinate-spaces';
import { createEdgePolicyDispatch } from '$lib/components/blocks/text/edge-policy-dispatch';
import { resolveSelectionEdit } from '$lib/components/blocks/text/live-selection-edit';
import { rangeDelete } from '$lib/selection/range-delete';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps, makePendingMarks } from '$lib/test/harness/editor-actions';
import { proseLeaves, type ProseLeaf } from './live-screen-reading';

export type GestureKind = 'type' | 'backspace' | 'delete' | 'enter' | 'range-delete' | 'type-over';

export interface Gesture {
	kind: GestureKind;
	/** Index into the addressable leaves, wrapped by the applier. */
	leaf: number;
	offset: number;
	endLeaf: number;
	endOffset: number;
	char: string;
	affinity: EdgeAffinity | null;
}

export interface Applied {
	doc: Document;
	bytes: string;
	/** Whether a caret-edge arm claimed the press, for the non-vacuity counters. */
	claimed: boolean;
}

// ── The block surface, as much of it as a keystroke reads ────────────────────

/** The block's rendered DOM: its own marker prefix, the inline render, the content-empty stamp.
 *  Images render as their source (the render path's own no-widget fallback), which keeps every
 *  byte in one caret space rather than behind an atomic island. */
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
	el.appendChild(renderInlineNodes(parseInline(node.raw, range.start, range.end), node.raw));
	el.toggleAttribute(CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome(el));
	root.appendChild(el);
	document.body.appendChild(root);
	placeCaretInText(el);
	return el;
}

/** A collapsed caret in painted text, which is what a real caret is: two dispatch arms read the
 *  DOM selection to tell a text caret from an element-level one. */
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
 * The leaves a gesture can address. A caret-edge press, a split and a selection replace go through
 * the document-level bundle, so they reach top-level prose only; a range delete takes paths and so
 * reaches a container's children too. One function, because the draw biases its offset against the
 * very node the applier will pick.
 */
export function gestureTargets(doc: Document, kind: GestureKind): ProseLeaf[] {
	if (kind === 'range-delete') return proseLeaves(doc);
	return doc.children.flatMap((child, index) =>
		child.children === undefined && isProseKind(child.kind) ? [{ path: [index], node: child }] : []
	);
}

/** Where a gesture lands, resolved once so the draw's bias and the classifier's questions address
 *  the very bytes the applier will touch. A range gesture answers with both endpoints. */
export function gestureSites(doc: Document, gesture: Gesture): { node: CstNode; offset: number }[] {
	const targets = gestureTargets(doc, gesture.kind);
	if (targets.length === 0) return [];
	const start = targets[gesture.leaf % targets.length].node;
	const site = { node: start, offset: clampOffset(start, gesture.offset) };
	if (gesture.kind === 'type' || gesture.kind === 'backspace' || gesture.kind === 'delete') {
		return [site];
	}
	const end = targets[gesture.endLeaf % targets.length].node;
	return [site, { node: end, offset: clampOffset(end, gesture.endOffset) }];
}

/** Into the content range, off a surrogate seam: half a code point is not a caret. */
function clampOffset(node: CstNode, offset: number): number {
	const { start, end } = getContentRange(node);
	const at = start + (offset % Math.max(1, end - start + 1));
	const code = node.raw.charCodeAt(at);
	return code >= 0xdc00 && code <= 0xdfff ? at - 1 : at;
}

// ── The gestures ─────────────────────────────────────────────────────────────

export async function applyGesture(
	source: string,
	gesture: Gesture,
	mode: PresentationMode | undefined
): Promise<Applied | null> {
	const h = harnessFor(source, mode);
	const claimed =
		gesture.kind === 'range-delete'
			? deleteRange(h, gesture, mode)
			: await applyBlockGesture(h, gesture, mode);
	if (claimed === null) return null;
	return { doc: h.doc, bytes: serialize(h.doc), claimed };
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
	const offset = clampOffset(node, gesture.offset);
	if (gesture.kind === 'enter') {
		await h.blockEdit.splitBlock(index, offset);
		return false;
	}
	if (gesture.kind === 'type-over') return replaceSelection(h, index, node, gesture, mode);
	return pressEdgeKey(h, index, node, offset, gesture, mode);
}

/** A printable key or a destructive press at `offset`, through the caret-edge dispatch. A press no
 *  arm claims falls to what the engine would do: the native cut, or the block merge at an edge. */
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
			return undefined;
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
		pendingMarks: makePendingMarks()
	});
	const event = new KeyboardEvent('keydown', { key, cancelable: true });
	if (dispatch.handleKeydown(event, asRawOffset(offset) as RawOffset)) return true;
	await nativePress(h, index, node, offset, gesture.kind, key);
	return false;
}

/** What the engine does with a press no arm took. */
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
		await write(splice(node.raw, offset, offset, key), offset + key.length);
		return;
	}
	// At a content extreme the press is a block gesture instead: the merge the caret is aimed at.
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

function codePointStart(raw: string, at: number): number {
	const code = raw.charCodeAt(at);
	return code >= 0xdc00 && code <= 0xdfff ? at - 1 : at;
}

/** Typing over a selection inside one block: the native replace, re-expressed as a join
 *  (live-mode.md § 4.5). A decline leaves the engine's own splice. */
function replaceSelection(
	h: Harness,
	index: number,
	node: CstNode,
	gesture: Gesture,
	mode: PresentationMode | undefined
): boolean {
	const a = clampOffset(node, gesture.offset);
	const b = clampOffset(node, gesture.endOffset);
	const [start, end] = a <= b ? [a, b] : [b, a];
	if (start === end) return false;
	const edit = resolveSelectionEdit(node, { start, end }, gesture.char, mode, undefined);
	if (edit) {
		void h.blockEdit.updateBlockContent(index, edit.raw, start, edit.caret);
		return true;
	}
	const raw = splice(node.raw, start, end, gesture.char);
	void h.blockEdit.updateBlockContent(index, raw, start, start + gesture.char.length);
	return false;
}

/** A range delete over any two prose leaves, container children included — the seam every
 *  cross-block delete, cut, and paste's delete half crosses. */
function deleteRange(
	h: Harness,
	gesture: Gesture,
	mode: PresentationMode | undefined
): boolean | null {
	const leaves = gestureTargets(h.doc, 'range-delete');
	if (leaves.length === 0) return null;
	const first = leaves[gesture.leaf % leaves.length];
	const second = leaves[gesture.endLeaf % leaves.length];
	const [lo, hi] = comparePaths(first.path, second.path) <= 0 ? [first, second] : [second, first];
	const a = clampOffset(lo.node, gesture.offset);
	const b = clampOffset(hi.node, gesture.endOffset);
	if (lo === hi && a === b) return null;
	const [startOffset, endOffset] = lo === hi && a > b ? [b, a] : [a, b];
	rangeDelete(
		h.doc,
		{ path: lo.path, offset: startOffset },
		{ path: hi.path, offset: endOffset },
		h.sharing,
		undefined,
		mode,
		undefined
	);
	return false;
}

function comparePaths(a: readonly number[], b: readonly number[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const diff = (a[i] ?? -1) - (b[i] ?? -1);
		if (diff !== 0) return diff;
	}
	return 0;
}
