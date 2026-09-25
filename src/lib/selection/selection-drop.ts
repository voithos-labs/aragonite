/**
 * Dragging a selection and dropping it, as one undo entry over two raw writes (the cut, then
 * the insert). The browser's own drag is two separate edits, which undo would take in two steps.
 */

import type { CstNode, Document } from '../core/nodes';
import type { Reading } from '../schema/reading';
import type { PluginActivation } from '../schema/plugin-activation';
import type { CommitController } from '../action-contracts';
import type { PasteCommitCoordinator } from '../tree-operations/paste/paste-deps';
import { emitClipboardError, type EditorEvents } from '../editor-events';
import { ambientLengthOf } from '../ambient/ambient-dom';
import { toClampedRawOffset, toDomTextOffset } from '../cursor/coordinate-spaces';
import { createRangeAtDomTextOffsets, domTextOffsetAtNode } from '../cursor/widget-offset';
import { documentLineEnding, trailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import { blockContentElAt } from '../components/block-el-lookup';
import { replaceRangeRaw } from '../components/blocks/text/live-selection-edit';
import {
	blockNodeAt,
	emptyParagraph,
	normalizeOwnRaw,
	writeOwnRaw
} from '../tree-operations/node-primitives';
import { cloneNode } from '../tree-operations/clone';
import { cutRangeFromDisplay } from '../tree-operations/node-ops';
import { rebuildAncestryRaw } from '../schema/container-raw';
import { applyPasteTransforms } from '../tree-operations/paste/paste-transforms';
import { replaceBlockAtParent } from '../tree-operations/paste/replace-block-at-parent';
import { parseReplacement } from '../tree-operations/paste/replacement-parse';
import { blockNearPoint } from './nearest-block';
import { findSurfaceForElement } from './path-lookup';
import { charOffsetOf } from './primitives';
import { containerAmbientPrefix } from './range-delete';

export interface SelectionDropDeps {
	editorRoot: HTMLElement;
	getDoc(): Document;
	controller: CommitController;
	coordinator: PasteCommitCoordinator;
	/** How the editor reads its bytes: the cut is a join, and the reparse reads its grammar. */
	reading: Reading;
	activePlugins: PluginActivation;
	/** The editor's event emitter: a move that throws halfway has nowhere else to report. */
	events: EditorEvents;
	/** Draws the caret saying where a release lands; null takes it away again. */
	setDropCaret(rect: DropCaretRect | null): void;
	isReadOnly(): boolean;
}

/** Where the drop caret stands, in viewport coordinates. */
export interface DropCaretRect {
	left: number;
	top: number;
	height: number;
}

/** Where the drag started, in raw offsets of the element it started in. */
interface DragSource {
	/** The editable element the range sits in: a block, or a table cell. */
	path: number[];
	start: number;
	end: number;
	inCell: boolean;
	/** The bytes the release writes, read once at `dragstart` so the caret shown while the drag
	 *  is held and the release itself cannot disagree about what moves. */
	text: string;
}

/** The cut's bytes, at the block whose raw carries them: the source block, or the table a cell's
 *  bytes are joined into. `shrunkBy` is how much that block's raw shrank. */
interface ScopeCut {
	path: number[];
	raw: string;
	shrunkBy: number;
}

/** A drag that is this gesture but in a shape this module does not move (a range leaving its
 *  element, an empty one, bytes holding a line break). The drop cancels it rather than handing
 *  it back to the browser. */
const DECLINED = 'declined';
type DragStash = DragSource | typeof DECLINED;

// ── Public entry ───────────────────────────────────────────────────────────

export function installSelectionDrop(deps: SelectionDropDeps): () => void {
	let source: DragStash | null = null;
	// The landing the painted caret stands at. A drag fires `dragover` over and over at one
	// position, and only a move to a different landing has a new caret to draw.
	let caretAt: { path: number[]; offset: number } | null = null;

	function hideCaret(): void {
		if (!caretAt) return;
		caretAt = null;
		deps.setDropCaret(null);
	}

	/** The caret saying where a release would land: cancelling the browser's drop takes its own
	 *  caret away, so this one stands at the landing the drop resolves and declines where it does. */
	function drawCaretAt(clientX: number, clientY: number, copy: boolean): void {
		const from = source;
		if (!from || from === DECLINED || deps.isReadOnly()) return hideCaret();
		const target = dropTarget(deps, clientX, clientY);
		if (!target) return hideCaret();
		// The same refusal `dropOffsetAfterCut` makes once the cut has shrunk the block, tested
		// here before the cut: a move has nowhere to put bytes inside the range it took them from.
		const inside =
			pathsEqual(target.path, from.path) && insideRange(target.offset, from.start, from.end);
		if (inside && !copy) {
			return hideCaret();
		}
		if (caretAt && caretAt.offset === target.offset && pathsEqual(caretAt.path, target.path)) {
			return;
		}
		const rect = dropCaretRect(deps.editorRoot, target.path, target.offset);
		if (!rect) return hideCaret();
		caretAt = target;
		deps.setDropCaret(rect);
	}

	const onDragStart = (e: DragEvent) => {
		source = readSelectionSource(deps, e.target);
	};
	const onDragEnd = () => {
		source = null;
		hideCaret();
	};
	// The editor is the drop target for every drag recognised here, declined ones included: the
	// drop handler below must run to cancel the browser's pair of native edits.
	const onDragOver = (e: DragEvent) => {
		if (!source) return;
		e.preventDefault();
		drawCaretAt(e.clientX, e.clientY, isCopyDrag(e));
	};
	// `dragleave` also fires for every child the pointer crosses, so the caret goes only once
	// the point is outside the editor's own box.
	const onDragLeave = (e: DragEvent) => {
		if (source && !isInside(deps.editorRoot, e.clientX, e.clientY)) hideCaret();
	};
	const onDrop = (e: DragEvent) => {
		const from = source;
		source = null;
		hideCaret();
		if (!from) return;
		// Before every decline below, not after: the browser's two edits land separately and its
		// undo is not the editor's, so a declined shape changes nothing rather than half of it.
		e.preventDefault();
		if (from === DECLINED || deps.isReadOnly()) return;
		const target = dropTarget(deps, e.clientX, e.clientY);
		if (!target) return;
		void runDrop(deps, from, target, isCopyDrag(e)).catch((error) => {
			// A throw between the two writes leaves an undo snapshot pushed and half the move
			// applied; the host hears about it on the same channel paste errors use.
			emitClipboardError(deps.events, { error, path: from.path });
		});
	};
	deps.editorRoot.addEventListener('dragstart', onDragStart);
	deps.editorRoot.addEventListener('dragend', onDragEnd);
	deps.editorRoot.addEventListener('dragover', onDragOver);
	deps.editorRoot.addEventListener('dragleave', onDragLeave);
	deps.editorRoot.addEventListener('drop', onDrop);
	return () => {
		// A reinstall mid-drag hands the new listeners no caret to clear, so it goes here.
		hideCaret();
		deps.editorRoot.removeEventListener('dragstart', onDragStart);
		deps.editorRoot.removeEventListener('dragend', onDragEnd);
		deps.editorRoot.removeEventListener('dragover', onDragOver);
		deps.editorRoot.removeEventListener('dragleave', onDragLeave);
		deps.editorRoot.removeEventListener('drop', onDrop);
	};
}

/** Ctrl, or Alt (Option, macOS's copy key for a drag): the release copies instead of moving. */
function isCopyDrag(e: DragEvent): boolean {
	return e.ctrlKey || e.altKey;
}

/** Where `target` ends up after a splice of `delta` blocks at `at` inside `parent`: what the
 *  drop's second write addresses once the first write's reparse changed the block count. */
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

/** Where a drop at `offset` lands once `[start, end)` has left the same block, which shrank by
 *  `shrunkBy` bytes after the join cleanup. Null inside the range. */
export function dropOffsetAfterCut(
	offset: number,
	start: number,
	end: number,
	shrunkBy: number
): number | null {
	if (insideRange(offset, start, end)) return null;
	return offset <= start ? offset : Math.max(0, offset - shrunkBy);
}

// ── Reading the gesture ────────────────────────────────────────────────────

/**
 * The native range the drag carries, in its element's raw offsets. `null` means not this
 * gesture, and leaves the drag to the browser; {@link DECLINED} is this gesture in a shape this
 * module does not move, which the drop cancels. A cross-block selection reaches neither: the
 * overlay paints it and leaves no native range for the browser to drag.
 */
function readSelectionSource(
	deps: SelectionDropDeps,
	dragged: EventTarget | null
): DragStash | null {
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	// An element that is draggable on its own (a rendered link, an image) is not this gesture,
	// even with a range painted elsewhere: a selection drag starts on a node the range covers.
	if (!(dragged instanceof Node) || !range.intersectsNode(dragged)) return null;
	const surface = surfaceOf(range.startContainer);
	if (!surface || !deps.editorRoot.contains(surface)) return null;
	// From here the drag is the editor's selection, so every remaining shape is declined.
	if (!surface.contains(range.endContainer)) return DECLINED;
	const found = findSurfaceForElement(surface);
	if (!found) return DECLINED;
	const ambient = ambientLengthOf(surface);
	const start = toClampedRawOffset(
		domTextOffsetAtNode(surface, range.startContainer, range.startOffset),
		ambient
	);
	const end = toClampedRawOffset(
		domTextOffsetAtNode(surface, range.endContainer, range.endOffset),
		ambient
	);
	if (start >= end) return DECLINED;
	const text = movedText(deps, { ...found, start, end });
	return text === null ? DECLINED : { ...found, start, end, text };
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

/** Viewport rect of the caret at `offset` in the block at `path`. A block whose offset names no
 *  text position falls back to its own box, and an unmounted one to null. */
function dropCaretRect(root: HTMLElement, path: number[], offset: number): DropCaretRect | null {
	const el = blockContentElAt(root, path);
	if (!el) return null;
	const at = toDomTextOffset(
		charOffsetOf({ path, offset }, 'selection-drop:caret'),
		ambientLengthOf(el)
	);
	const rect = createRangeAtDomTextOffsets(el, at, at)?.getBoundingClientRect();
	if (rect && rect.height > 0) return { left: rect.left, top: rect.top, height: rect.height };
	const box = el.getBoundingClientRect();
	return box.height > 0 ? { left: box.left, top: box.top, height: box.height } : null;
}

function isInside(el: HTMLElement, clientX: number, clientY: number): boolean {
	const box = el.getBoundingClientRect();
	return clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
}

/** The source element's bytes for the range, after the paste transforms. Null for text this
 *  module does not handle: a line break needs the structural paste path. */
function movedText(deps: SelectionDropDeps, from: Omit<DragSource, 'text'>): string | null {
	const node = blockNodeAt(deps.getDoc(), from.path);
	if (!node) return null;
	const raw = trimTrailingLineEnding(node.raw).slice(from.start, from.end);
	const text = applyPasteTransforms(raw, deps.activePlugins);
	return text && !/[\r\n]/.test(text) ? text : null;
}

// ── The commit ─────────────────────────────────────────────────────────────

async function runDrop(
	deps: SelectionDropDeps,
	from: DragSource,
	to: { path: number[]; offset: number },
	copy: boolean
): Promise<void> {
	const text = from.text;
	if (copy) {
		await writeBlockRaw(deps, to.path, insert(to.offset, text), to.offset + text.length, true);
		return;
	}
	const cut = cutFrom(deps, from);
	if (!cut) return;
	if (pathsEqual(cut.path, to.path)) {
		const offset = dropOffsetAfterCut(to.offset, from.start, from.end, cut.shrunkBy);
		if (offset === null) return;
		const merged = spliceAt(cut.raw, offset, text);
		await writeBlockRaw(deps, cut.path, () => merged, offset + text.length, true);
		return;
	}
	deps.controller.pushUndoSnapshotPath(from.path, from.start);
	// A table's `focus` takes a cell, never a character offset (G1.29), so the temporary caret
	// the second write moves away from is its first cell.
	const sourceCaret = from.inCell ? 0 : from.start;
	const spliced = await writeBlockRaw(deps, cut.path, () => cut.raw, sourceCaret, false);
	const at = cut.path[cut.path.length - 1];
	const target = shiftPathAfterSplice(to.path, cut.path.slice(0, -1), at, spliced);
	await writeBlockRaw(deps, target, insert(to.offset, text), to.offset + text.length, false);
}

function insert(offset: number, text: string): (raw: string) => string {
	return (raw) => spliceAt(raw, offset, text);
}

/** The source element's display bytes with the dragged range gone, through the range delete so
 *  a live-mode join cleans up after itself. */
function cutFrom(deps: SelectionDropDeps, from: DragSource): ScopeCut | null {
	const node = blockNodeAt(deps.getDoc(), from.path);
	if (!node) return null;
	if (from.inCell) return cutFromCell(deps, from, node);
	const before = trimTrailingLineEnding(node.raw);
	const edit = replaceRangeRaw(
		node,
		{ start: from.start, end: from.end },
		'',
		deps.reading,
		containerAmbientPrefix(deps.getDoc(), from.path),
		documentLineEnding(deps.getDoc())
	);
	const raw = trimTrailingLineEnding(edit.raw);
	return { path: from.path, raw, shrunkBy: before.length - raw.length };
}

/** A cell's bytes are joined into its row, so the table is the block the cut rewrites: the cell's
 *  own range delete on a copy, then the kind's escaping and the ancestor rebuild around it. */
function cutFromCell(deps: SelectionDropDeps, from: DragSource, cell: CstNode): ScopeCut | null {
	const tablePath = from.path.slice(0, -2);
	// The cell path is resolved from a DOM selector contract, so the kind is read, not assumed.
	const table = blockNodeAt(deps.getDoc(), tablePath);
	if (!table || table.kind !== 'table') return null;
	const cut = cutRangeFromDisplay(
		cell,
		cell.raw,
		{ start: from.start, end: from.end },
		deps.reading
	);
	const rebuilt = cloneNode(table);
	const inner = from.path.slice(-2);
	const [rowIdx, colIdx] = inner;
	const written = rebuilt.children?.[rowIdx]?.children?.[colIdx];
	if (!written) return null;
	writeOwnRaw(written, cut.display, documentLineEnding(deps.getDoc()), deps.reading.grammar);
	rebuildAncestryRaw(rebuilt, inner);
	const raw = trimTrailingLineEnding(rebuilt.raw);
	return { path: tablePath, raw, shrunkBy: trimTrailingLineEnding(table.raw).length - raw.length };
}

/**
 * Replaces the block at `path` with the reparse of the bytes `rewrite` returns, in its parent's
 * child list. Returns how many blocks the position grew or shrank by, which keeps a second
 * write's path correct. `own` pushes this write's own undo entry.
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
	// The bytes are built outside the block's own element, so the kind's write rule runs here.
	const lineEnding = documentLineEnding(doc);
	const written = normalizeOwnRaw(node, rewrite(trimTrailingLineEnding(node.raw)), lineEnding);
	// A block emptied by the cut keeps its position as a blank paragraph: no splice, so the
	// second write's path is still the one resolved at the drop.
	const parsed = parseReplacement(node, written, lineEnding, deps.reading.grammar, () => [
		emptyParagraph(node.leadingTrivia ?? '', trailingLineEnding(node.raw, lineEnding))
	]);
	if (!parsed) return 0;
	const landed = await replaceBlockAtParent({
		doc,
		blockPath: path,
		replacement: parsed.replacement,
		controller: deps.coordinator,
		undoEntry: own ? 'own' : 'join',
		focusReplacementIndex: parsed.replacement.length - 1,
		focusOffset: caret,
		source: 'selection-drop',
		grammar: deps.reading.grammar
	});
	// The count that landed, not the parse's: a container's body rule can rewrite the list. Zero
	// means the parent was not mounted and nothing was written, so nothing moved.
	return Math.max(0, landed - 1);
}

// ── Small helpers ──────────────────────────────────────────────────────────

function spliceAt(raw: string, offset: number, text: string): string {
	const at = Math.max(0, Math.min(offset, raw.length));
	return raw.slice(0, at) + text + raw.slice(at);
}

/** Strictly between `start` and `end`: a position the dragged range itself covers. */
function insideRange(offset: number, start: number, end: number): boolean {
	return offset > start && offset < end;
}

function pathsEqual(a: number[], b: number[]): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}

function surfaceOf(node: Node): HTMLElement | null {
	let el = node instanceof HTMLElement ? node : node.parentElement;
	while (el && el.contentEditable !== 'true') el = el.parentElement;
	return el;
}
