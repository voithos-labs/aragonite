/**
 * The cell runner, assertion helpers and tree traversals the conformance kits share. A failure is
 * a plain thrown `Error`, so using one never forces a suite to load a test runner.
 */

import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import { parse } from '../core/parser';
import type { BlockKindDescriptor } from '../schema/block-kind-descriptor';

// ── Coverage vocabulary ──────────────────────────────────────────────────────

/**
 * How a cell is covered: `assert` runs the real check, `exempt` means the invariant has nothing
 * to test here, `boundary` means it needs something headless code cannot reach. Both of the
 * non-asserting modes carry a real reason, so nothing is ever skipped silently.
 */
export type ConformanceCoverage =
	{ mode: 'assert' } | { mode: 'exempt'; reason: string } | { mode: 'boundary'; reason: string };

// ── Cell runner ──────────────────────────────────────────────────────────────

export type CellStatus = 'asserted' | 'exempt' | 'boundary';

export interface CellReport<Cell extends string = string> {
	cell: Cell;
	status: CellStatus;
	/** Why a cell was excused, or which mechanism an asserted cell drove. */
	detail?: string;
}

/** What a check returns: nothing or a detail line when it ran, or an explicit status when it
 *  could not do its work, which is never reported `asserted`. */
export type CellOutcome = void | string | { status: CellStatus; detail: string };

export interface KitCell<Cell extends string, Ctx> {
	cell: Cell;
	/** The profile's declaration for the cell; a cell without one always runs. */
	coverage?: (ctx: Ctx) => ConformanceCoverage;
	run: (ctx: Ctx) => CellOutcome | Promise<CellOutcome>;
	/** Throws when the declared excuse can be disproved. */
	falsify?: (ctx: Ctx) => void;
}

/** Runs one cell, or throws its failure; `subject` names the kind or handler in messages. */
export async function runCell<Cell extends string, Ctx>(
	kitCell: KitCell<Cell, Ctx>,
	ctx: Ctx,
	subject: string
): Promise<CellReport<Cell>> {
	const { cell } = kitCell;
	const coverage = kitCell.coverage?.(ctx) ?? { mode: 'assert' };
	if (coverage.mode !== 'assert') {
		assertExemptionDocumented(coverage, `${subject} ${cell}`);
		kitCell.falsify?.(ctx);
		return { cell, status: coverage.mode, detail: coverage.reason };
	}
	const outcome = await kitCell.run(ctx);
	if (outcome === undefined) return { cell, status: 'asserted' };
	if (typeof outcome === 'string') return { cell, status: 'asserted', detail: outcome };
	if (outcome.status !== 'asserted') {
		assertReasonDocumented(outcome.detail, `${subject} ${cell} ${outcome.status} reason`);
	}
	return { cell, ...outcome };
}

/** Runs every cell and throws one `Error` under `heading` naming each failure, `earlier` ones
 *  (found before any cell ran) first. */
export async function runCells<Cell extends string, Ctx>(
	cells: readonly KitCell<Cell, Ctx>[],
	ctx: Ctx,
	names: { subject: string; heading: string },
	earlier: readonly string[] = []
): Promise<CellReport<Cell>[]> {
	const reports: CellReport<Cell>[] = [];
	const failures = [...earlier];
	for (const kitCell of cells) {
		try {
			reports.push(await runCell(kitCell, ctx, names.subject));
		} catch (error) {
			failures.push(`${kitCell.cell}: ${(error as Error).message}`);
		}
	}
	if (failures.length > 0) fail(`${names.heading}:\n  - ${failures.join('\n  - ')}`);
	return reports;
}

// ── Assertion kit ────────────────────────────────────────────────────────────

export function fail(message: string): never {
	throw new Error(message);
}

export function assert(condition: unknown, message: string): asserts condition {
	if (!condition) fail(message);
}

export function assertIs(actual: unknown, expected: unknown, message: string): void {
	if (!Object.is(actual, expected)) {
		fail(`${message} — expected ${show(expected)}, got ${show(actual)}`);
	}
}

export function assertIndices(
	actual: readonly number[],
	expected: readonly number[],
	message: string
): void {
	if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
		fail(`${message} — expected [${expected}], got [${actual}]`);
	}
}

export function show(value: unknown): string {
	return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** A documented reason says something, never a bare token: a skip has to be visible. */
export function assertReasonDocumented(reason: string, label: string): void {
	assert(reason.length > 20, `${label} is documented`);
}

/** An exempt or boundary cell carries a real reason, so the skip stays visible. */
export function assertExemptionDocumented(cell: ConformanceCoverage, label: string): void {
	if (cell.mode === 'assert') {
		fail(`assertExemptionDocumented called on an 'assert' cell: ${label}`);
	}
	assertReasonDocumented(cell.reason, `${label} ${cell.mode} reason`);
}

/**
 * A byte-faithful rebuild must reproduce the parsed bytes (a grid one canonicalizes widths, so it
 * only has to run). Writes `node.raw` in place: pass a fresh parse, never a node a cell shares.
 */
export function assertRebuildIsParseCanonical(
	descriptor: BlockKindDescriptor,
	node: CstNode,
	label: string
): void {
	const before = node.raw;
	try {
		descriptor.rebuildRaw!(node);
	} catch (error) {
		fail(`${label} rebuildRaw throws over a parsed fixture: ${(error as Error).message}`);
	}
	if (descriptor.containerContract !== 'grid') {
		assertIs(node.raw, before, `${label} rebuildRaw reproduces the parse-canonical raw`);
	}
}

// ── Tree walks ───────────────────────────────────────────────────────────────

export function firstChildOfKind(source: string, kind: AnyBlockKind): CstNode {
	const node = parse(source).children[0];
	assertIs(node.kind, kind, `sample's first child is "${kind}"`);
	assert(node.children, 'sample container has children');
	return node;
}

export function nodeAtPath(root: Document | CstNode, path: number[]): CstNode {
	let cur: Document | CstNode = root;
	for (const i of path) {
		assert(cur.children, 'path step has children');
		cur = cur.children[i];
	}
	assert('raw' in cur, 'path resolves to a block node');
	return cur;
}

/** First node of `kind` in a pre-order traversal (the kind may be nested below the root). */
export function findFirstOfKind(root: Document | CstNode, kind: AnyBlockKind): CstNode | null {
	for (const child of root.children ?? []) {
		if (child.kind === kind) return child;
		const found = findFirstOfKind(child, kind);
		if (found) return found;
	}
	return null;
}

/** Document-rooted path of the first node of `kind` in a pre-order traversal, or null. */
export function findFirstPathOfKind(root: Document | CstNode, kind: AnyBlockKind): number[] | null {
	const children = root.children ?? [];
	for (let i = 0; i < children.length; i++) {
		if (children[i].kind === kind) return [i];
		const deeper = findFirstPathOfKind(children[i], kind);
		if (deeper) return [i, ...deeper];
	}
	return null;
}

export function pathPassesThroughKind(
	doc: Document,
	leafPath: number[],
	kind: AnyBlockKind
): boolean {
	let cur: Document | CstNode = doc;
	for (let depth = 0; depth < leafPath.length - 1; depth++) {
		cur = cur.children![leafPath[depth]];
		if (cur.kind === kind) return true;
	}
	return false;
}
