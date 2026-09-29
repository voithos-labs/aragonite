/**
 * What a live range covers, decided once from the document so the delete, the copy and the
 * overlay all read one answer. Every reader takes a `CoveredRange`, and only `coverRange` builds
 * one, so no consumer can be handed a pair that skipped the rule; `rangeCoverage` then says which
 * edges the range keeps a part of and which subtrees it holds whole.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { displayLength } from '../core/lines';
import { metadataOf } from '../core/nodes';
import { cellIndexOf, normalize, type SelectionPoint } from './primitives';
import { snapCrossBlockTableEndpoints } from './table-endpoint-snap';
import { collapsedContainerHiding } from './path-lookup';
import {
	comparePaths,
	isPathBetween,
	isPathSubtreeBetween,
	isStrictAncestorOf,
	pathHasPrefix,
	pathsEqual,
	type DocPath
} from './path-math';
import { cellRectBounds, docPathFrom, type CellRect } from '../cursor/coordinate-spaces';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { isBlankParagraph } from '../core/parser';
import { countsCells, isGridKind, tableCellCount } from '../schema/block-kind-descriptor';
import { isWholeBlockUnit } from '../schema/whole-block-unit';
import {
	isCollapsedContainer,
	isReservedChromeChild,
	reservedChromeKindOf
} from '../schema/reserved-chrome';

const SEAL = Symbol('coverRange');

/** A live range in document order as every reader must see it: table endpoints snapped to whole
 *  rows, and each closed container the range takes whole named in `wholeUnits`. */
export class CoveredRange {
	// Never read: the private field makes the type nominal, so a spread or a literal isn't one.
	// eslint-disable-next-line no-unused-private-class-members
	readonly #covered = true;
	readonly start: SelectionPoint;
	readonly end: SelectionPoint;
	/** Collapsed containers taken whole, outermost only, in document order. */
	readonly wholeUnits: readonly DocPath[];

	/** Built by `coverRange` only, which holds the module-private key. */
	constructor(
		key: typeof SEAL,
		start: SelectionPoint,
		end: SelectionPoint,
		wholeUnits: readonly DocPath[]
	) {
		if (key !== SEAL) throw new Error('a CoveredRange is built by coverRange');
		this.start = start;
		this.end = end;
		this.wholeUnits = wholeUnits;
		Object.freeze(this);
	}

	/** The container in `wholeUnits` holding `path`, or null. */
	unitHolding(path: readonly number[]): DocPath | null {
		return this.wholeUnits.find((unit) => pathHasPrefix(path, unit)) ?? null;
	}
}

/** A half-open run of row-major cell indices inside one table. */
export interface CellRun {
	readonly from: number;
	readonly to: number;
}

/** How much of a table a pair inside it holds: all of it, whole rows or columns, or less. */
export type GridKind = 'table' | 'row' | 'column' | 'cells';

/** The cells a pair inside one table holds, as a rectangle, and what that rectangle amounts to. */
export type GridCoverage = {
	[K in GridKind]: { readonly kind: K; readonly path: DocPath; readonly rect: CellRect };
}[GridKind];

/** A same-path pair (a block held whole, a cell rectangle) is returned as is. A closed title row
 *  the range starts on, or ends on past its first byte, takes its container whole. */
export function coverRange(doc: DocumentView, a: SelectionPoint, b: SelectionPoint): CoveredRange {
	const ordered = normalize({ anchor: a, focus: b });
	if (pathsEqual(ordered.start.path, ordered.end.path)) {
		return sealed(ordered.start, ordered.end, []);
	}
	const { start, end } = snapCrossBlockTableEndpoints(doc, ordered.start, ordered.end);
	const units: DocPath[] = [];
	const startUnit = closedTitleOwner(doc, start.path);
	if (startUnit) units.push(startUnit);
	const endUnit = end.offset > 0 ? closedTitleOwner(doc, end.path) : null;
	if (endUnit) units.push(endUnit);
	return sealed(start, end, units);
}

/** What a covered range holds, read once by the delete, the copy, the format toggle and the
 *  overlay. Built by `rangeCoverage` only, so no consumer can be handed a hand-made answer. */
export class RangeCoverage {
	// Never read: the private field makes the type nominal, as `CoveredRange`'s does.
	// eslint-disable-next-line no-unused-private-class-members
	readonly #coverage = true;
	readonly range: CoveredRange;
	/** The start block's kept head, from its first byte or cell to the start; null where the
	 *  range holds the block whole. */
	readonly startEdge: SelectionPoint | null;
	/** The end block's kept tail, from the end to its last byte or cell; null likewise. */
	readonly endEdge: SelectionPoint | null;
	/** Every subtree the range removes whole, outermost only, in document order. */
	readonly wholeRoots: readonly DocPath[];
	/** Every subtree whose bytes the range covers end to end, outermost only: the whole roots and
	 *  a kept edge at its block's first or last byte, with the containers they complete. */
	readonly coveredWhole: readonly DocPath[];
	/** For a pair inside one table, which of its cells the range holds; null otherwise. */
	readonly grid: GridCoverage | null;
	/** The cells a kept table edge hands to the range, as a half-open row-major run: from the
	 *  start's cell to the table's end, or from its first cell through the end's. */
	readonly startCells: CellRun | null;
	readonly endCells: CellRun | null;

	/** Built by `rangeCoverage` only, which holds the module-private key. */
	constructor(key: typeof SEAL, range: CoveredRange, fields: CoverageFields) {
		if (key !== SEAL) throw new Error('a RangeCoverage is built by rangeCoverage');
		this.range = range;
		this.startEdge = fields.startEdge;
		this.endEdge = fields.endEdge;
		this.wholeRoots = fields.wholeRoots;
		this.coveredWhole = fields.coveredWhole;
		this.grid = fields.grid;
		this.startCells = fields.startCells;
		this.endCells = fields.endCells;
		Object.freeze(this);
	}

	/** The whole root holding `path`, or null. */
	rootHolding(path: readonly number[]): DocPath | null {
		return this.wholeRoots.find((root) => pathHasPrefix(path, root)) ?? null;
	}

	/** The subtree in `coveredWhole` holding `path`, or null. */
	coveredRootHolding(path: readonly number[]): DocPath | null {
		return this.coveredWhole.find((root) => pathHasPrefix(path, root)) ?? null;
	}
}

/** A text edge always keeps its head or tail, even an empty one; a block with no character
 *  position, a table from its first or to its last row, or a whole unit keeps none. */
export function rangeCoverage(doc: DocumentView, range: CoveredRange): RangeCoverage {
	const { start, end } = range;
	if (pathsEqual(start.path, end.path)) {
		return new RangeCoverage(SEAL, range, samePathCoverage(doc, start, end));
	}
	const held = walkBetween(doc, start.path, end.path).filter((p) =>
		isPathSubtreeBetween(p, start.path, end.path)
	);
	for (const unit of range.wholeUnits) held.push(unit);
	const startHeld = range.unitHolding(start.path) !== null || edgeHeld(doc, start, 'start');
	const endHeld = range.unitHolding(end.path) !== null || endConsumed(doc, range);
	if (startHeld) held.push(start.path);
	if (endHeld) held.push(end.path);
	// A kept edge still hands over every byte of its block when it sits on that block's edge.
	const covered = held.slice();
	if (!startHeld && edgeCoversBlock(doc, start, 'start')) covered.push(start.path);
	if (!endHeld && edgeCoversBlock(doc, end, 'end')) covered.push(end.path);
	return new RangeCoverage(SEAL, range, {
		startEdge: startHeld ? null : start,
		endEdge: endHeld ? null : end,
		wholeRoots: outermost(withWholeParents(doc, held)),
		coveredWhole: outermost(withWholeParents(doc, covered)),
		grid: null,
		startCells: startHeld ? null : keptTableRun(doc, start, 'start'),
		endCells: endHeld ? null : keptTableRun(doc, end, 'end')
	});
}

/** Every block path strictly between `start` and `end`, at every nesting level, in document
 *  order; an ancestor of `end` counts, since it starts before `end` does. */
export function walkBetween(
	doc: DocumentView,
	start: readonly number[],
	end: readonly number[]
): number[][] {
	if (comparePaths(start, end) >= 0) return [];
	const result: number[][] = [];
	const visit = (node: NodeView | DocumentView, path: number[]): void => {
		if (isPathBetween(path, start, end)) result.push([...path]);
		const children = node.children ?? [];
		for (let i = 0; i < children.length; i++) {
			const childPath = [...path, i];
			// Skip subtrees entirely before start (an ancestor of start still holds it) or after end.
			if (!pathHasPrefix(start, childPath) && comparePaths(childPath, start) < 0) continue;
			if (comparePaths(childPath, end) >= 0) break;
			visit(children[i], childPath);
		}
	};
	visit(doc, []);
	return result;
}

// ── Title-line containers ───────────────────────────────────────────────────

/** A container whose kind reserves its first child as a title row (a details block's summary). */
export interface ChromeContainer {
	path: number[];
	node: NodeView;
}

/** The deepest strict ancestor of `path` whose kind reserves a title row. */
export function nearestChromeContainer(
	doc: DocumentView,
	path: readonly number[]
): ChromeContainer | null {
	let found: ChromeContainer | null = null;
	let children = doc.children;
	for (let i = 0; i < path.length - 1; i++) {
		const node = children[path[i]];
		if (!node) break;
		if (reservedChromeKindOf(node.kind) !== undefined) found = { path: path.slice(0, i + 1), node };
		children = node.children ?? [];
	}
	return found;
}

export function isChromeChild(container: ChromeContainer, leafPath: readonly number[]): boolean {
	return (
		leafPath.length === container.path.length + 1 &&
		isReservedChromeChild(container.node, leafPath[container.path.length])
	);
}

// ── Internal ────────────────────────────────────────────────────────────────

function sealed(start: SelectionPoint, end: SelectionPoint, wholeUnits: DocPath[]): CoveredRange {
	return new CoveredRange(SEAL, start, end, wholeUnits);
}

/** The collapsed container whose title row `path` is; null for a row inside another container's
 *  hidden body, since the range already covers what follows it. */
function closedTitleOwner(doc: DocumentView, path: readonly number[]): DocPath | null {
	if (path.length < 2) return null;
	const ownerPath = path.slice(0, -1);
	const owner = nodeAt(doc, ownerPath);
	if (!owner || !isBlockNode(owner)) return null;
	if (!isReservedChromeChild(owner, path[path.length - 1]) || !isCollapsedContainer(owner)) {
		return null;
	}
	return collapsedContainerHiding(doc, ownerPath) ? null : docPathFrom(ownerPath);
}

interface CoverageFields {
	startEdge: SelectionPoint | null;
	endEdge: SelectionPoint | null;
	wholeRoots: readonly DocPath[];
	coveredWhole: readonly DocPath[];
	grid: GridCoverage | null;
	startCells: CellRun | null;
	endCells: CellRun | null;
}

function samePathCoverage(
	doc: DocumentView,
	start: SelectionPoint,
	end: SelectionPoint
): CoverageFields {
	const node = nodeAt(doc, start.path);
	const path = docPathFrom(start.path);
	if (node && isBlockNode(node) && countsCells(node) && start.cellCoordinate) {
		const grid = gridCoverage(node, path, start.offset, end.offset);
		return grid.kind === 'table' ? heldWhole(path, grid) : { ...kept(start, end), grid };
	}
	// A paragraph emptied stays as the blank line between its neighbours; another kind emptied
	// reads back as no block of that kind at all, so it goes.
	const heldAsUnit =
		node !== null &&
		isBlockNode(node) &&
		start.offset === 0 &&
		end.offset >= displayLength(node.raw) &&
		!isBlankParagraph({ kind: node.kind, raw: '' });
	return heldAsUnit ? heldWhole(path, null) : kept(start, end);
}

function kept(start: SelectionPoint, end: SelectionPoint): CoverageFields {
	return {
		startEdge: start,
		endEdge: end,
		wholeRoots: [],
		coveredWhole: [],
		grid: null,
		startCells: null,
		endCells: null
	};
}

function heldWhole(path: DocPath, grid: GridCoverage | null): CoverageFields {
	return {
		startEdge: null,
		endEdge: null,
		wholeRoots: [path],
		coveredWhole: [path],
		grid,
		startCells: null,
		endCells: null
	};
}

/** The cells a kept table edge's side of the range spans; null for an edge that isn't a table. */
function keptTableRun(
	doc: DocumentView,
	point: SelectionPoint,
	side: 'start' | 'end'
): CellRun | null {
	const node = nodeAt(doc, point.path);
	if (!node || !isBlockNode(node) || !countsCells(node)) return null;
	const cell = cellIndexOf(point, 'rangeCoverage:tableEdge');
	return side === 'start' ? { from: cell, to: tableCellCount(node) } : { from: 0, to: cell + 1 };
}

/** A whole table beats the row or column that spans it (a one-row or one-column table). */
function gridCoverage(table: NodeView, path: DocPath, a: number, b: number): GridCoverage {
	const columnCount = metadataOf(table, 'table').columnCount;
	const rowCount = table.children?.length ?? 0;
	const rect = cellRectBounds(a, b, columnCount);
	const fullWidth = rect.left === 0 && rect.cols === columnCount;
	const fullHeight = rect.top === 0 && rect.rows === rowCount;
	const kind: GridKind =
		fullWidth && fullHeight
			? 'table'
			: fullWidth && rect.rows === 1
				? 'row'
				: fullHeight && rect.cols === 1
					? 'column'
					: 'cells';
	return { kind, path, rect };
}

/** An edge holds its block whole when nothing of it lies outside the range. A character offset on
 *  a plugin grid's own path addresses no cell, so it reads as the grid's edge. */
function edgeHeld(doc: DocumentView, point: SelectionPoint, side: 'start' | 'end'): boolean {
	const node = nodeAt(doc, point.path);
	if (!node || !isBlockNode(node)) return false;
	if (countsCells(node)) {
		return point.offset === (side === 'start' ? 0 : tableCellCount(node) - 1);
	}
	if (isGridKind(node.kind)) return true;
	if (!isWholeBlockUnit(node)) return false;
	return side === 'start' ? point.offset === 0 : point.offset >= displayLength(node.raw);
}

/** A text edge at its block's first byte (a start) or last (an end), so a copy takes the block. */
function edgeCoversBlock(doc: DocumentView, point: SelectionPoint, side: 'start' | 'end'): boolean {
	if (point.cellCoordinate) return false;
	const node = nodeAt(doc, point.path);
	if (!node || !isBlockNode(node)) return false;
	return side === 'start' ? point.offset === 0 : point.offset >= displayLength(node.raw);
}

/** The end holds its block whole as a start does, and also on the last byte of a title-line
 *  container's last block with the start outside it, since nothing merges across that edge. */
function endConsumed(doc: DocumentView, range: CoveredRange): boolean {
	const { start, end } = range;
	if (edgeHeld(doc, end, 'end')) return true;
	const container = nearestChromeContainer(doc, end.path);
	if (!container || pathHasPrefix(start.path, container.path)) return false;
	const node = lastChildDescendant(container, end.path);
	return node !== null && 'raw' in node && end.offset >= displayLength(node.raw);
}

/** The node at `path` when every step down from the container is a last child, else null. */
function lastChildDescendant(container: ChromeContainer, path: readonly number[]): NodeView | null {
	let node: NodeView = container.node;
	for (let i = container.path.length; i < path.length; i++) {
		const children = node.children ?? [];
		if (path[i] !== children.length - 1) return null;
		node = children[path[i]];
	}
	return node;
}

/** `held` plus every container all of whose children it holds, up to the document. */
function withWholeParents(doc: DocumentView, held: readonly (readonly number[])[]): number[][] {
	const all = held.map((p) => p.slice());
	const keys = new Set(all.map(pathKey));
	for (let i = 0; i < all.length; i++) {
		const parentPath = all[i].slice(0, -1);
		if (parentPath.length === 0 || keys.has(pathKey(parentPath))) continue;
		const count = nodeAt(doc, parentPath)?.children?.length ?? 0;
		let whole = count > 0;
		for (let c = 0; whole && c < count; c++) whole = keys.has(pathKey([...parentPath, c]));
		if (!whole) continue;
		keys.add(pathKey(parentPath));
		all.push(parentPath);
	}
	return all;
}

function outermost(paths: readonly number[][]): DocPath[] {
	const roots = paths.filter(
		(p, i) => !paths.some((q, j) => isStrictAncestorOf(q, p) || (j < i && pathsEqual(q, p)))
	);
	return roots.sort(comparePaths).map(docPathFrom);
}

function pathKey(path: readonly number[]): string {
	return path.join('.');
}
