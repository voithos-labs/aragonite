/**
 * Dragging a selection and dropping it. The browser's own version is two native edits committed
 * apart — `deleteByDrag` on the source, `insertFromDrop` on the target — so undo takes two presses
 * over a document that lost bytes in between, and inside one block the source commit rebuilds the
 * surface under the drop. Owned here instead: one snapshot over two raw writes, which splice
 * nothing, so no path moves under the second.
 */

import type { CstNode, Document } from '../core/nodes';
import type { GrammarView } from '../schema/block-openers';
import type { LinkReferenceResolverRef, PresentationModeGetter } from '../editor-keys';
import type { PluginActivation } from '../schema/plugin-activation';
import type { CommitController } from '../action-contracts';
import type { PasteCommitCoordinator } from '../tree-operations/paste/paste-deps';
import { ambientLengthOf } from '../ambient/ambient-dom';
import { toClampedRawOffset } from '../cursor/coordinate-spaces';
import { domTextOffsetAtNode } from '../cursor/widget-offset';
import { terminateLine, trailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import { parse } from '../core/parser';
import { deleteRangeRaw } from '../components/blocks/text/live-selection-edit';
import { ensureEditableContainers } from '../tree-operations';
import {
	blockNodeAt,
	emptyParagraph,
	normalizeReplacementTrivia
} from '../tree-operations/node-primitives';
import { applyPasteTransforms } from '../tree-operations/paste/paste-transforms';
import { replaceBlockAtParent } from '../tree-operations/paste/replace-block-at-parent';
import { blockNearPoint } from './nearest-block';
import { findBlockPathForElement, findCellPathForElement } from './path-lookup';
import { containerAmbientPrefix } from './range-delete';

export interface SelectionDropDeps {
	editorRoot: HTMLElement;
	getDoc(): Document;
	controller: CommitController;
	coordinator: PasteCommitCoordinator;
	getPresentationMode: PresentationModeGetter | undefined;
	linkRef: LinkReferenceResolverRef | undefined;
	grammar: GrammarView | undefined;
	activePlugins: PluginActivation | undefined;
	isReadOnly(): boolean;
}

/** Where the drag started, in the source block's raw offsets. */
interface DragSource {
	path: number[];
	start: number;
	end: number;
}

// ── Public entry ───────────────────────────────────────────────────────────

export function installSelectionDrop(deps: SelectionDropDeps): () => void {
	let source: DragSource | null = null;
	const onDragStart = (e: DragEvent) => {
		source = readSelectionSource(deps.editorRoot, e.target);
	};
	const onDragEnd = () => {
		source = null;
	};
	// The editor is the drop target for a drag it owns, instead of each point inheriting the
	// browser's own verdict on whether anything may land there.
	const onDragOver = (e: DragEvent) => {
		if (source) e.preventDefault();
	};
	const onDrop = (e: DragEvent) => {
		const from = source;
		source = null;
		if (!from || deps.isReadOnly()) return;
		const target = dropTarget(deps, e.clientX, e.clientY);
		if (!target) return;
		const text = movedText(deps, from);
		if (text === null) return;
		// Ahead of the await: the default is the pair of native edits this owns instead.
		e.preventDefault();
		void runDrop(deps, from, target, text, e.ctrlKey || e.altKey);
	};
	deps.editorRoot.addEventListener('dragstart', onDragStart);
	deps.editorRoot.addEventListener('dragend', onDragEnd);
	deps.editorRoot.addEventListener('dragover', onDragOver);
	deps.editorRoot.addEventListener('drop', onDrop);
	return () => {
		deps.editorRoot.removeEventListener('dragstart', onDragStart);
		deps.editorRoot.removeEventListener('dragend', onDragEnd);
		deps.editorRoot.removeEventListener('dragover', onDragOver);
		deps.editorRoot.removeEventListener('drop', onDrop);
	};
}

/** Where a splice of `delta` blocks at `at` inside `parent` leaves `target`. Pure, and the one
 *  reason the two writes below may run in either order safely. */
export function shiftPathAfterSplice(
	target: number[],
	parent: number[],
	at: number,
	delta: number
): number[] {
	if (delta === 0 || target.length <= parent.length) return target;
	for (let i = 0; i < parent.length; i++) if (target[i] !== parent[i]) return target;
	if (target[parent.length] <= at) return target;
	const shifted = target.slice();
	shifted[parent.length] += delta;
	return shifted;
}

/** Where a drop at `offset` lands once `[start, end)` left the same block, `shrunkBy` bytes
 *  shorter than the range was wide once the join seam cleaned up. Null inside the range. */
export function dropOffsetAfterCut(
	offset: number,
	start: number,
	end: number,
	shrunkBy: number
): number | null {
	if (offset > start && offset < end) return null;
	return offset <= start ? offset : Math.max(0, offset - shrunkBy);
}

// ── Reading the gesture ────────────────────────────────────────────────────

/** The native range the drag carries, in its block's raw offsets. Null unless the drag grips one
 *  editable block's own range: a cross-block selection paints through the overlay and leaves no
 *  native range for the browser to drag. */
function readSelectionSource(
	editorRoot: HTMLElement,
	dragged: EventTarget | null
): DragSource | null {
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	// A draggable of its own (a rendered link, an image) is not this gesture, even with a range
	// painted elsewhere: a selection drag grips a node the range covers.
	if (!(dragged instanceof Node) || !range.intersectsNode(dragged)) return null;
	const surface = surfaceOf(range.startContainer);
	if (!surface || !editorRoot.contains(surface) || !surface.contains(range.endContainer)) {
		return null;
	}
	const path = proseBlockPath(surface);
	if (!path) return null;
	const ambient = ambientLengthOf(surface);
	const start = toClampedRawOffset(
		domTextOffsetAtNode(surface, range.startContainer, range.startOffset),
		ambient
	);
	const end = toClampedRawOffset(
		domTextOffsetAtNode(surface, range.endContainer, range.endOffset),
		ambient
	);
	return start < end ? { path, start, end } : null;
}

/** The block and offset a drop point addresses, as a single-click caret would land. Null where
 *  the point names no character position (a whole-block unit, a table cell). */
function dropTarget(
	deps: SelectionDropDeps,
	clientX: number,
	clientY: number
): { path: number[]; offset: number } | null {
	const near = blockNearPoint(deps.editorRoot, clientX, clientY);
	const point = near?.endpointHere();
	if (!point || !('offset' in point) || point.cellCoordinate) return null;
	return blockNodeAt(deps.getDoc(), point.path) ? { path: point.path, offset: point.offset } : null;
}

/** The source block's own bytes for the range, past the paste transforms. Null for a payload
 *  this seam does not own: a line break needs the structural paste route. */
function movedText(deps: SelectionDropDeps, from: DragSource): string | null {
	const node = blockNodeAt(deps.getDoc(), from.path);
	if (!node) return null;
	const raw = trimTrailingLineEnding(node.raw).slice(from.start, from.end);
	const text = applyPasteTransforms(raw, deps.activePlugins);
	return text && !/[\r\n]/.test(text) ? text : null;
}

// ── The commit ceremony ────────────────────────────────────────────────────

async function runDrop(
	deps: SelectionDropDeps,
	from: DragSource,
	to: { path: number[]; offset: number },
	text: string,
	copy: boolean
): Promise<void> {
	if (copy) {
		await writeBlockRaw(deps, to.path, insert(to.offset, text), to.offset + text.length, true);
		return;
	}
	const cut = cutFrom(deps, from);
	if (!cut) return;
	if (pathsEqual(from.path, to.path)) {
		const offset = dropOffsetAfterCut(to.offset, from.start, from.end, cut.shrunkBy);
		if (offset === null) return;
		const merged = spliceAt(cut.raw, offset, text);
		await writeBlockRaw(deps, from.path, () => merged, offset + text.length, true);
		return;
	}
	deps.controller.pushUndoSnapshotPath(from.path, from.start);
	const spliced = await writeBlockRaw(deps, from.path, () => cut.raw, from.start, false);
	const at = from.path[from.path.length - 1];
	const target = shiftPathAfterSplice(to.path, from.path.slice(0, -1), at, spliced);
	await writeBlockRaw(deps, target, insert(to.offset, text), to.offset + text.length, false);
}

function insert(offset: number, text: string): (raw: string) => string {
	return (raw) => spliceAt(raw, offset, text);
}

/** The source block's display bytes with the dragged range gone, through the delete seam so a
 *  live-mode join cleans up after itself. */
function cutFrom(
	deps: SelectionDropDeps,
	from: DragSource
): { raw: string; shrunkBy: number } | null {
	const node = blockNodeAt(deps.getDoc(), from.path);
	if (!node) return null;
	const before = trimTrailingLineEnding(node.raw);
	const edit = deleteRangeRaw(
		node,
		{ start: from.start, end: from.end },
		deps.getPresentationMode?.(),
		deps.linkRef,
		containerAmbientPrefix(deps.getDoc(), from.path)
	);
	const raw = trimTrailingLineEnding(edit.raw);
	return { raw, shrunkBy: before.length - raw.length };
}

/**
 * Replace the block at `path` with the reparse of the bytes `rewrite` returns, at its parent
 * scope. Answers how many blocks the slot grew or shrank by, which is what keeps a second
 * write's path honest. `own` pushes this write's own undo entry.
 */
async function writeBlockRaw(
	deps: SelectionDropDeps,
	path: number[],
	rewrite: (displayRaw: string) => string,
	caret: number,
	own: boolean
): Promise<number> {
	const doc = deps.getDoc();
	const node = blockNodeAt(doc, path);
	if (!node) return 0;
	const written = rewrite(trimTrailingLineEnding(node.raw));
	const replacement = reparsed(node, written, deps.grammar);
	await replaceBlockAtParent({
		doc,
		blockPath: path,
		replacement,
		controller: deps.coordinator,
		undoEntry: own ? 'own' : 'join',
		focusReplacementIndex: replacement.length - 1,
		focusOffset: caret,
		source: 'selection-drop',
		...(deps.grammar ? { grammar: deps.grammar } : {})
	});
	return replacement.length - 1;
}

function reparsed(original: CstNode, raw: string, grammar: GrammarView | undefined): CstNode[] {
	const ending = trailingLineEnding(original.raw);
	const parsed = parse(terminateLine(raw, original.raw), { grammar, scope: 'fragment' });
	const children =
		parsed.children.length > 0
			? parsed.children
			: [emptyParagraph(original.leadingTrivia ?? '', ending)];
	const replacement = normalizeReplacementTrivia(original, children);
	for (const node of replacement) ensureEditableContainers(node);
	return replacement;
}

// ── Small helpers ──────────────────────────────────────────────────────────

function spliceAt(raw: string, offset: number, text: string): string {
	const at = Math.max(0, Math.min(offset, raw.length));
	return raw.slice(0, at) + text + raw.slice(at);
}

function pathsEqual(a: number[], b: number[]): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}

function surfaceOf(node: Node): HTMLElement | null {
	let el = node instanceof HTMLElement ? node : node.parentElement;
	while (el && el.contentEditable !== 'true') el = el.parentElement;
	return el;
}

/** The block path of a prose surface; null for a table cell, whose offsets are cell indices. */
function proseBlockPath(surface: HTMLElement): number[] | null {
	return findCellPathForElement(surface) ? null : findBlockPathForElement(surface);
}
