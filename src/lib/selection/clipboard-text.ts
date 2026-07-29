/**
 * Cross-block clipboard text collection.
 */

import type { SelectionPoint } from './primitives';
import { makeBlockNode, metadataOf, type CstNode } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { cloneMetadata } from '../tree-operations/clone';
import { isBlockNode, nodeAt } from '../tree-operations/node-ops';
import { walkBetween, normalize, charOffsetOf, cellIndexOf } from './primitives';
import { snapCrossBlockTableEndpoints } from './table-endpoint-snap';
import { isStrictAncestorOf, pathHasPrefix, pathsEqual, sharedPrefixLength } from './path-math';
import { cellRowCol } from '../cursor/coordinate-spaces';
import { displayLength, terminateLine } from '../core/lines';
import { copyRectangleAsSubTable } from '../tree-operations/sub-table-copy';
import { isReservedChromeChild } from '../schema/reserved-chrome';
import { getBlockKindDescriptor, tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Collect the plain-text content spanning a cross-block selection. Includes
 * the tail of the start block's raw, the full leadingTrivia + raw of every
 * middle block, and the head of the end block's raw.
 *
 * walkBetween yields containers AND their children; a container's raw already
 * includes its children's text, so we skip descendants of already-collected
 * containers to avoid duplication.
 *
 * Leaf endpoints at full-boundary offsets promote to their deepest non-shared
 * container ancestor so structural formatting (list markers, blockquote
 * prefixes) is preserved.
 *
 * A start inside a container's reserved chrome buffers what the walk collects
 * from inside that container and re-emits the container around it once, so the
 * copy keeps its kind instead of flattening to a chrome tail plus a bare body.
 */
export function collectCrossBlockText(
	doc: DocumentView,
	anchor: SelectionPoint,
	focus: SelectionPoint
): string {
	const normalized = normalize({ anchor, focus });
	const { start, end } = snapCrossBlockTableEndpoints(doc, normalized.start, normalized.end);
	const startNode = nodeAt(doc, start.path);
	const endNode = nodeAt(doc, end.path);
	if (!startNode || !endNode) return '';

	// On a table, offsets index half-open cell ranges (see `SelectionPoint`),
	// not character positions; the three table branches below route through
	// emitTablePortion so the generic raw.slice paths don't return garbage.
	// Same-path intra-table copy: the endpoints' cell offsets are context-
	// established (same table, unflagged), so they read directly. The cross-block
	// table branches below carry the flag and use cellIndexOf.
	if (pathsEqual(start.path, end.path) && isBlockNode(startNode) && startNode.kind === 'table') {
		// Cell offsets are inclusive on both ends, matching the cross-block table
		// branches (`+ 1` below). A collapsed pair (equal offsets) is a caret in a
		// cell, not a rect — copy nothing and let the cell's native copy handle it.
		if (start.offset === end.offset) return '';
		return emitTablePortion(startNode, start.offset, end.offset + 1);
	}

	const startRaw = isBlockNode(startNode) ? startNode.raw : '';
	const endRaw = isBlockNode(endNode) ? endNode.raw : '';

	let effectiveStartPath = start.path;
	let chromeStart: ChromeStartContainer | null = null;
	let startTail = '';
	if (isBlockNode(startNode) && startNode.kind === 'table') {
		const tableNode = startNode;
		const colCount = metadataOf(tableNode, 'table').columnCount;
		const allCellsCount = tableNode.children!.length * colCount;
		startTail = emitTablePortion(
			tableNode,
			cellIndexOf(start, 'collectCrossBlockText:startTable'),
			allCellsCount
		);
	} else {
		const startOffset = charOffsetOf(start, 'collectCrossBlockText:start');
		if (startOffset === 0 && start.path.length > 1) {
			const promoted = promoteToContainer(doc, start.path, end.path, 'start');
			if (promoted) {
				effectiveStartPath = promoted.path;
				startTail = promoted.raw;
			} else {
				startTail = startRaw.slice(startOffset);
			}
		} else if (startOffset > 0 && start.path.length > 1) {
			// A chrome start emits nothing here: its wrapper needs the body it
			// encloses, which only the walk below knows.
			chromeStart = startChromeContainer(doc, start, startRaw, startOffset);
			if (!chromeStart) {
				const marker = soleChildContainerPrefix(doc, start.path, startRaw);
				startTail = (marker ?? '') + startRaw.slice(startOffset);
			}
		} else {
			startTail = startRaw.slice(startOffset);
		}
	}

	let effectiveEndPath = end.path;
	let endHead: string;
	if (isBlockNode(endNode) && endNode.kind === 'table') {
		// Snapped end cell is the inclusive last cell of its row; emitTablePortion
		// takes an exclusive end. +1 makes the captured rows match the delete.
		endHead = emitTablePortion(endNode, 0, cellIndexOf(end, 'collectCrossBlockText:endTable') + 1);
	} else {
		const endOffset = charOffsetOf(end, 'collectCrossBlockText:end');
		const chromeBytes = endOffset > 0 ? endChromeContainerBytes(doc, end, endRaw, endOffset) : null;
		if (chromeBytes !== null) {
			endHead = chromeBytes;
		} else if (endOffset === displayLength(endRaw) && end.path.length > 1) {
			const promoted = promoteToContainer(doc, end.path, start.path, 'end');
			if (promoted) {
				effectiveEndPath = promoted.path;
				endHead = promoted.raw;
			} else {
				endHead = endRaw.slice(0, endOffset);
			}
		} else if (endOffset > 0 && endOffset < displayLength(endRaw) && end.path.length > 1) {
			const marker = soleChildContainerPrefix(doc, end.path, endRaw);
			endHead = (marker ?? '') + endRaw.slice(0, endOffset);
		} else {
			endHead = endRaw.slice(0, endOffset);
		}
	}

	let middle = '';
	let chromeBody = '';
	const collectedContainers: number[][] = [];

	for (const path of walkBetween(doc, effectiveStartPath, effectiveEndPath)) {
		if (isStrictAncestorOf(path, effectiveStartPath)) continue;
		if (isStrictAncestorOf(path, effectiveEndPath)) continue;
		if (isStrictAncestorOf(effectiveStartPath, path)) continue;
		if (isStrictAncestorOf(effectiveEndPath, path)) continue;

		if (collectedContainers.some((cp) => isStrictAncestorOf(cp, path))) continue;

		const node = nodeAt(doc, path);
		if (!node || !isBlockNode(node)) continue;
		if (chromeStart && pathHasPrefix(path, chromeStart.path)) {
			chromeBody += node.leadingTrivia + node.raw;
		} else {
			middle += node.leadingTrivia + node.raw;
		}

		if (node.children && node.children.length > 0) {
			collectedContainers.push(path);
		}
	}

	// Without endLead, blank lines between paragraphs get dropped and paste reparses as a single merged paragraph.
	let endLead = '';
	if (!pathsEqual(effectiveStartPath, effectiveEndPath)) {
		const endNode = nodeAt(doc, effectiveEndPath);
		if (endNode && isBlockNode(endNode)) {
			endLead = endNode.leadingTrivia;
		}
	}

	if (chromeStart) {
		// The container's subtree is one contiguous doc-order run, so an end inside it
		// leaves `middle` empty and puts the end's own bytes inside the wrapper too.
		const exited = !pathHasPrefix(effectiveEndPath, chromeStart.path);
		const tail = endLead + endHead;
		const wrapped = wrapChromeStartContainer(
			chromeStart,
			exited ? chromeBody : chromeBody + tail,
			exited
		);
		return exited ? wrapped + middle + tail : wrapped;
	}

	return startTail + middle + endLead + endHead;
}

// ── Internal ───────────────────────────────────────────────────────────────

/**
 * Emit a table portion for the half-open cell-index range
 * `[startCellIdx, endCellIdxExclusive)` in row-major order. Selection is
 * row-rectangular by GFM constraint; emit `[startRow..endRow] × all columns`.
 */
function emitTablePortion(
	table: NodeView,
	startCellIdx: number,
	endCellIdxExclusive: number
): string {
	if (startCellIdx >= endCellIdxExclusive) return '';
	const colCount = metadataOf(table, 'table').columnCount;
	const allCellsCount = table.children!.length * colCount;
	if (startCellIdx === 0 && endCellIdxExclusive === allCellsCount) {
		return table.raw;
	}
	const startRow = cellRowCol(startCellIdx, colCount).row;
	const endRow = cellRowCol(endCellIdxExclusive - 1, colCount).row;
	return copyRectangleAsSubTable(
		table,
		{ rowIdx: startRow, colIdx: 0 },
		{ rowIdx: endRow, colIdx: colCount - 1 }
	);
}

/**
 * The container marker prefix a partial-leaf clipboard slice must keep when the
 * leaf is the sole child of a strip container (e.g. "3. " so "3. thi" survives
 * rather than "thi"). Without it, CommonMark §5.2 stops a following "N." line
 * from interrupting the paragraph and the round-trip collapses into one
 * multi-line block. Null when the container isn't eligible — the callers prepend
 * nothing and keep the bare leaf slice.
 *
 * Eligibility is the descriptor's `strip` contract (raw is a per-line marker
 * around serialize(children)), not a kind list: listItem, blockquote, githubAlert
 * and footnote-def all recover their wrapper by the same suffix arithmetic.
 *
 * Sole-child is required: with earlier siblings, their text sits between the
 * marker and the leaf's raw, so the suffix arithmetic wouldn't recover a prefix.
 */
function soleChildContainerPrefix(
	doc: DocumentView,
	leafPath: number[],
	leafRaw: string
): string | null {
	const parent = nodeAt(doc, leafPath.slice(0, -1));
	if (!parent || !isBlockNode(parent) || !parent.children) return null;
	if (tryGetBlockKindDescriptor(parent.kind)?.containerContract !== 'strip') return null;
	if (parent.children.length !== 1) return null;
	if (leafPath[leafPath.length - 1] !== 0) return null;
	if (!parent.raw.endsWith(leafRaw)) return null;
	return parent.raw.slice(0, parent.raw.length - leafRaw.length);
}

/**
 * The rebuild a chrome-wrapper synthesis may run for `container`, or null when
 * re-emitting its wrapper is not the faithful answer. Both chrome endpoint paths
 * below consult this and nothing else, so the rule cannot hold on one endpoint
 * and not the other.
 *
 * The `'opaque'` gate carries the weight: an opaque container's syntax is an
 * opener line plus a closer, so a truncated chrome IS an opener and the kind's
 * rebuildRaw supplies the matching close. A `'strip'` container's syntax is a
 * per-line prefix with nothing to close, and the same synthesis would emit a
 * wrapper the kind never opens (`> Tit` around a callout's title) —
 * `soleChildContainerPrefix` is that family's seam. `'grid'` containers declare
 * no chrome and ride the table arm.
 */
function chromeWrapperRebuild(
	container: NodeView,
	childIndex: number
): ((node: CstNode) => void) | null {
	if (!isReservedChromeChild(container, childIndex)) return null;
	const descriptor = getBlockKindDescriptor(container.kind);
	if (descriptor.containerContract !== 'opaque') return null;
	return descriptor.rebuildRaw ?? null;
}

/**
 * Bytes for a copy endpoint that lands inside a container's reserved chrome (a
 * title/summary whose syntax lives in the container's own raw). The generic
 * raw.slice emits wrapper-less bytes that reparse to a bare paragraph — the kind
 * lost on paste — and the marker-recovery seam above can't help (it derives the
 * prefix by suffix arithmetic and gates on a single body child, which no chrome
 * container with a body satisfies). Instead synthesize a chrome-only container —
 * truncated chrome raw, empty body, the live node's metadata — and run the
 * kind's own rebuildRaw, yielding canonical reparseable bytes (`:::note Ti\n:::\n`)
 * generically off the chrome predicate. The gesture means "copy into a title" →
 * a container with that title and an empty body.
 *
 * rebuildRaw is contractually read-only over metadata (rebuildCalloutRaw /
 * rebuildDetailsRaw read `calloutType`/`open` and write only `raw`), but here it
 * is plugin code fed a node aliasing the LIVE tree — shallow-copy the metadata
 * (primitive-valued by the G1.6 convention) so a misbehaving plugin cannot write
 * through the clipboard path into the document.
 */
function endChromeContainerBytes(
	doc: DocumentView,
	end: SelectionPoint,
	endRaw: string,
	endOffset: number
): string | null {
	const childIndex = end.path[end.path.length - 1];
	const parent = nodeAt(doc, end.path.slice(0, -1));
	if (!parent || !isBlockNode(parent)) return null;

	const rebuildRaw = chromeWrapperRebuild(parent, childIndex);
	if (!rebuildRaw) return null;

	// A synthetic node built from the parent's runtime kind for a rebuildRaw probe.
	const synthetic = makeBlockNode({
		kind: parent.kind,
		leadingTrivia: '',
		raw: '',
		metadata: parent.metadata ? cloneMetadata(parent.metadata) : undefined,
		innerPrefix: '',
		innerSuffix: '',
		children: [
			makeBlockNode({
				kind: parent.children![childIndex].kind,
				leadingTrivia: '',
				raw: endRaw.slice(0, endOffset)
			})
		]
	});
	rebuildRaw(synthetic);
	return synthetic.raw;
}

interface ChromeStartContainer {
	path: number[];
	node: NodeView;
	/** The chrome leaf from the start offset on — the truncated title/summary. */
	chromeTail: string;
	rebuildRaw: (node: CstNode) => void;
}

/**
 * The container a copy STARTS inside the chrome of, when re-emitting its wrapper
 * around the collected body is the faithful answer; null when it isn't. The
 * eligibility rule is `chromeWrapperRebuild`'s, shared with the END path.
 */
function startChromeContainer(
	doc: DocumentView,
	start: SelectionPoint,
	startRaw: string,
	startOffset: number
): ChromeStartContainer | null {
	const containerPath = start.path.slice(0, -1);
	const container = nodeAt(doc, containerPath);
	if (!container || !isBlockNode(container)) return null;

	const rebuildRaw = chromeWrapperRebuild(container, start.path[start.path.length - 1]);
	if (!rebuildRaw) return null;
	return {
		path: containerPath,
		node: container,
		chromeTail: startRaw.slice(startOffset),
		rebuildRaw
	};
}

/**
 * Re-emit the container around `body` — the bytes the walk collected from inside
 * it — with the truncated chrome back in the opener line. ONE rebuildRaw call
 * over the real body, which is what makes the closer trustworthy: a directive
 * fence widens when its body reproduces the terminator, and deriving opener and
 * closer in the same call means they cannot disagree about the width. A closer
 * emitted separately where the walk exits would have to re-derive it.
 *
 * `exited` means the walk left the container's subtree, i.e. its body was
 * captured to the end — only then does the container's trailing inner trivia
 * belong to the copy. Without that trivia a body stopping mid-line would run
 * into the closer, so the slice is line-terminated instead.
 *
 * Metadata is shallow-copied for the reason `endChromeContainerBytes` copies it:
 * rebuildRaw is plugin code, and nothing on this node may alias the live tree.
 */
function wrapChromeStartContainer(
	start: ChromeStartContainer,
	body: string,
	exited: boolean
): string {
	const { node } = start;
	const innerSuffix = exited ? (node.innerSuffix ?? '') : '';
	const synthetic = makeBlockNode({
		kind: node.kind,
		leadingTrivia: '',
		// The live raw, so the rebuild reads the authored closer line ending (G4.20).
		raw: node.raw,
		metadata: node.metadata ? cloneMetadata(node.metadata) : undefined,
		innerPrefix: node.innerPrefix ?? '',
		innerSuffix,
		children: [
			makeBlockNode({ kind: node.children![0].kind, leadingTrivia: '', raw: start.chromeTail }),
			// One stand-in for the whole collected body: a rebuild serializes its
			// children's bytes, so the kind is immaterial and only the bytes travel.
			makeBlockNode({
				kind: 'paragraph',
				leadingTrivia: '',
				raw: innerSuffix === '' && body !== '' ? terminateLine(body, node.raw) : body
			})
		]
	});
	start.rebuildRaw(synthetic);
	return synthetic.raw;
}

/**
 * Walk up from a leaf endpoint, promoting to the deepest container ancestor
 * whose content is entirely within the selection scope. Start-side promotion
 * is safe only while each child is the first; end-side, only while last.
 */
function promoteToContainer(
	doc: DocumentView,
	leafPath: number[],
	otherPath: number[],
	side: 'start' | 'end'
): { path: number[]; raw: string } | null {
	const lcaDepth = sharedPrefixLength(leafPath, otherPath);

	let bestPath: number[] | null = null;

	for (let depth = leafPath.length - 1; depth > lcaDepth; depth--) {
		const parentPath = leafPath.slice(0, depth);
		const parent = nodeAt(doc, parentPath);
		if (!parent || !parent.children) break;

		const childIndex = leafPath[depth];

		if (side === 'start' && childIndex !== 0) break;
		if (side === 'end' && childIndex !== parent.children.length - 1) break;

		bestPath = parentPath;
	}

	if (!bestPath || bestPath.length <= lcaDepth) return null;
	const node = nodeAt(doc, bestPath);
	if (!node || !isBlockNode(node)) return null;
	return { path: bestPath, raw: node.raw };
}
