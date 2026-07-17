/**
 * The generic per-kind conformance battery — the executable half of the closure
 * matrix. Registering a block kind ENROLLS it: `runKindConformance` derives one
 * cell per `ClosureColumn` from the kind's `closure` block and its
 * `conformanceFixture`, and runs the headless part of each cell now. "A matrix
 * row is executed, not declared."
 *
 * Cell-execution contract (honest by construction — a cell is executed only where
 * its mechanism is headlessly observable; everything else is recorded, never
 * stubbed green):
 *
 *   column          mode              what executes
 *   ─────────────── ───────────────── ──────────────────────────────────────────
 *   roundTrip       any (fixtured)    serialize(parse(fixture)) === fixture;
 *                                      containers also assert rebuildRaw is deterministic
 *   mergeBackspace  any               isMergeEligible agrees with the merge-role table
 *                                      (an independent restatement, not a re-derivation)
 *   clipboard       inherit-default   copy is a raw byte slice — no kind synthesis
 *   clipboard       implemented       the profile's custom check, else boundary
 *   undo            inherit-default   one structural op → exactly one undo entry
 *   searchPaint     not-supported     the document scan finds no match (degradation)
 *   focus / selectionPaint / searchPaint(other) / reorder / simOracle  → boundary
 *
 * A browser- or e2e-only cell is `boundary`: the next batch's browser sweep runs
 * it. A `not-supported` cell with no generic degradation is `exempt`, carrying
 * its declared reason. A profile's custom check is honored ONLY where the cell is
 * declared `implemented`; on any other mode it contradicts the declaration and the
 * run fails, so reverting a profiled cell's mode cannot silence its guard.
 * Runner-agnostic — plain `Error`s, no runner import.
 */

import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import { displayLength } from '../core/lines';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import type { ClosureCell, ClosureColumn } from '../schema/closure';
import {
	getBlockKindDescriptor,
	type BlockKindDescriptor,
	type MergeRole
} from '../schema/block-kind-descriptor';
import { isMergeEligible } from '../schema/merge-rules';
import { collectCrossBlockText } from '../selection/clipboard-text';
import type { SelectionPoint } from '../selection/primitives';
import { pathsEqual } from '../selection/path-math';
import { scanDocument } from '../search/document-scan';
import { compileMatcher } from '../search/matcher';
import { createBlockEditActions } from '../editor-actions/block-edit';
import { createUndoController } from '../editor-actions/commit/undo-controller';
import { assert, assertIs, fail, findFirstPathOfKind, nodeAtPath } from './conformance-core';
import { createHeadlessActions } from './headless-actions';

// ── Report + profile ─────────────────────────────────────────────────────────

export type KindCellStatus = 'executed' | 'boundary' | 'exempt';

export interface KindCellReport {
	column: ClosureColumn;
	mode: ClosureCell['mode'];
	status: KindCellStatus;
	/** Why a cell is boundary/exempt, or which mechanism an executed cell drove. */
	detail: string;
}

export interface KindConformanceReport {
	kind: AnyBlockKind;
	cells: KindCellReport[];
}

/**
 * The parsed fixture context a cell executor (and a profile's custom check) reads.
 * Present only when the kind declares a `conformanceFixture`.
 */
export interface KindCellContext {
	kind: AnyBlockKind;
	descriptor: BlockKindDescriptor;
	fixture: string;
	doc: Document;
	node: CstNode;
	nodePath: number[];
}

export interface KindCellCheck {
	check: (ctx: KindCellContext) => void | Promise<void>;
}

/**
 * Profile-supplied overrides. A column with a custom `check` runs it instead of
 * the generic executor — the seam a kind uses to exercise a mechanism-specific
 * cell the runner cannot observe generically (e.g. table's rectangular copy).
 */
export interface KindConformanceProfile {
	cells?: Partial<Record<ClosureColumn, KindCellCheck>>;
}

// ── Runner ───────────────────────────────────────────────────────────────────

const CLOSURE_ORDER: ClosureColumn[] = [
	'roundTrip',
	'focus',
	'mergeBackspace',
	'selectionPaint',
	'searchPaint',
	'reorder',
	'undo',
	'clipboard',
	'simOracle'
];

/**
 * Execute every headless closure cell for `kind`. Resolves with the per-cell
 * report when every executed cell holds and every boundary/exempt cell is
 * recorded; throws an `Error` naming each failed cell otherwise. A declared
 * `conformanceFixture` that parses to no node of the kind is itself a failure —
 * the whole run would exercise the wrong tree.
 */
export async function runKindConformance(
	kind: AnyBlockKind,
	profile: KindConformanceProfile = {}
): Promise<KindConformanceReport> {
	const descriptor = getBlockKindDescriptor(kind);
	const ctx = buildContext(kind, descriptor);

	const cells: KindCellReport[] = [];
	const failures: string[] = [];

	for (const column of CLOSURE_ORDER) {
		const cell = descriptor.closure[column];
		try {
			const custom = profile.cells?.[column]?.check;
			const result = custom
				? await runCustomCheck(kind, column, cell, custom, ctx)
				: await executeCell(column, cell, kind, descriptor, ctx);
			if (result.status === 'exempt') {
				assert(result.detail.length > 20, `${kind} ${column} exempt reason is documented`);
			}
			cells.push({ column, mode: cell.mode, ...result });
		} catch (error) {
			failures.push(`${column}: ${(error as Error).message}`);
		}
	}

	if (failures.length > 0) {
		fail(`kind conformance failed for "${kind}":\n  - ${failures.join('\n  - ')}`);
	}
	return { kind, cells };
}

function buildContext(kind: AnyBlockKind, descriptor: BlockKindDescriptor): KindCellContext | null {
	const fixture = descriptor.conformanceFixture;
	if (fixture === undefined) return null;
	const doc = parse(fixture);
	const nodePath = findFirstPathOfKind(doc, kind);
	if (!nodePath) {
		fail(`kind conformance failed for "${kind}": conformanceFixture parses to no "${kind}" node`);
	}
	return { kind, descriptor, fixture, doc, node: nodeAtPath(doc, nodePath), nodePath };
}

type CellResult = { status: KindCellStatus; detail: string };

async function runCustomCheck(
	kind: AnyBlockKind,
	column: ClosureColumn,
	cell: ClosureCell,
	check: KindCellCheck['check'],
	ctx: KindCellContext | null
): Promise<CellResult> {
	// A profile custom check is the seam for an `implemented` cell whose mechanism
	// the generic executor cannot observe (table's rectangular copy). On any other
	// declared mode it is a contradiction: the cell claims the default ceremony
	// (`inherit-default`) or structural absence (`not-supported`), yet a bespoke
	// check overrides — silencing the declared-mode executor. Refusing it here is
	// what makes reverting a profiled cell off `implemented`, with the profile left
	// intact (the table-clipboard cell that lied about its rect-copy mechanism), go red rather than stay green.
	if (cell.mode !== 'implemented') {
		fail(
			`profile supplies a "${column}" check for "${kind}", but its declared mode is ` +
				`"${cell.mode}" — a custom check is only valid on an 'implemented' cell`
		);
	}
	if (!ctx) {
		fail(
			`profile supplies a "${column}" check but "${kind}" has no conformanceFixture to run it over`
		);
	}
	await check(ctx);
	return { status: 'executed', detail: 'profile custom check' };
}

// ── Cell executors ─────────────────────────────────────────────────────────

const BROWSER_SWEEP = 'browser cell — executed in the browser sweep';

async function executeCell(
	column: ClosureColumn,
	cell: ClosureCell,
	kind: AnyBlockKind,
	descriptor: BlockKindDescriptor,
	ctx: KindCellContext | null
): Promise<CellResult> {
	switch (column) {
		case 'roundTrip':
			return execRoundTrip(kind, descriptor, ctx);
		case 'mergeBackspace':
			return execMergeBackspace(kind, descriptor.mergeRole);
		case 'searchPaint':
			return execSearchPaint(cell, ctx);
		case 'undo':
			return execUndo(cell, ctx);
		case 'clipboard':
			return execClipboard(cell, ctx);
		case 'focus':
			return { status: 'boundary', detail: `native caret / focus policy — ${BROWSER_SWEEP}` };
		case 'selectionPaint':
			return { status: 'boundary', detail: `selection cover paint — ${BROWSER_SWEEP}` };
		case 'reorder':
			return execReorder(cell);
		case 'simOracle':
			return {
				status: 'boundary',
				detail:
					'note-taking simulation under the corruption oracles — executed in the e2e sim battery'
			};
	}
}

function execRoundTrip(
	kind: AnyBlockKind,
	descriptor: BlockKindDescriptor,
	ctx: KindCellContext | null
): CellResult {
	if (!ctx) {
		return {
			status: 'boundary',
			detail: `no conformanceFixture — round-trip runs in the ${BROWSER_SWEEP}`
		};
	}
	assertIs(
		serialize(parse(ctx.fixture)),
		ctx.fixture,
		`serialize(parse(fixture)) round-trips for "${kind}"`
	);
	if (descriptor.rebuildRaw) {
		const first = rebuildRawOf(kind, ctx.fixture, descriptor);
		const second = rebuildRawOf(kind, ctx.fixture, descriptor);
		assertIs(first, second, `"${kind}" rebuildRaw is deterministic`);
		return { status: 'executed', detail: 'byte round-trip + rebuildRaw determinism' };
	}
	return { status: 'executed', detail: 'byte round-trip' };
}

/**
 * An independent restatement of the merge-role → Backspace-merge table
 * (docs/design/editor.md). Re-deriving the expectation from `isMergeEligible`
 * would make the check vacuous; stating it here catches a mergeRole/closure drift
 * or a silent change to the eligibility rules.
 */
const MERGE_ROLE_EXPECTATION: Record<
	MergeRole,
	{ currentIntoProse: boolean; prevForProse: boolean; self: boolean }
> = {
	prose: { currentIntoProse: true, prevForProse: true, self: true },
	'prose-absorber': { currentIntoProse: false, prevForProse: true, self: false },
	container: { currentIntoProse: false, prevForProse: true, self: false },
	'self-merge': { currentIntoProse: false, prevForProse: false, self: true },
	'not-mergeable': { currentIntoProse: false, prevForProse: false, self: false }
};

function execMergeBackspace(kind: AnyBlockKind, role: MergeRole): CellResult {
	const expected = MERGE_ROLE_EXPECTATION[role];
	assertIs(
		isMergeEligible('paragraph', kind),
		expected.currentIntoProse,
		`"${kind}" (${role}) Backspace-merges as the current block into a prose predecessor`
	);
	assertIs(
		isMergeEligible(kind, 'paragraph'),
		expected.prevForProse,
		`"${kind}" (${role}) absorbs a following prose block`
	);
	assertIs(
		isMergeEligible(kind, kind),
		expected.self,
		`"${kind}" (${role}) self-merge eligibility`
	);
	return { status: 'executed', detail: `mergeRole=${role} eligibility` };
}

function execSearchPaint(cell: ClosureCell, ctx: KindCellContext | null): CellResult {
	if (cell.mode !== 'not-supported') {
		return { status: 'boundary', detail: `search-match mark overlay — ${BROWSER_SWEEP}` };
	}
	if (!ctx) return { status: 'exempt', detail: cell.reason };
	const needle = firstVisibleChar(ctx.node.raw);
	if (needle === null) return { status: 'exempt', detail: cell.reason };
	const compiled = compileMatcher(needle, { caseSensitive: true, wholeWord: false, regex: false });
	if (!compiled.ok) return { status: 'exempt', detail: cell.reason };
	// Non-vacuous: the needle IS present in the raw, so no match can only mean the
	// document scan deliberately skips this non-searchable kind.
	assert(
		compiled.matcher.findAll(ctx.node.raw).length > 0,
		`needle "${needle}" is present in the "${ctx.kind}" raw`
	);
	const hits = scanDocument(ctx.doc, compiled.matcher).filter((m) =>
		pathsEqual(m.path, ctx.nodePath)
	);
	assertIs(hits.length, 0, `the document scan finds no match in the non-searchable "${ctx.kind}"`);
	return { status: 'executed', detail: 'document scan finds no match (degradation)' };
}

function execReorder(cell: ClosureCell): CellResult {
	if (cell.mode === 'not-supported') return { status: 'exempt', detail: cell.reason };
	return {
		status: 'boundary',
		detail: `block reorder is an Alt+Arrow / drag gesture — ${BROWSER_SWEEP}`
	};
}

async function execUndo(cell: ClosureCell, ctx: KindCellContext | null): Promise<CellResult> {
	if (cell.mode === 'not-supported') return { status: 'exempt', detail: cell.reason };
	if (cell.mode === 'implemented') {
		return {
			status: 'boundary',
			detail: `kind-specific undo mechanism — supply a profile check or run it in the ${BROWSER_SWEEP}`
		};
	}
	if (!ctx)
		return {
			status: 'boundary',
			detail: `no conformanceFixture — undo depth runs in the ${BROWSER_SWEEP}`
		};

	// One structural op → one undo entry: the commit ceremony's property, driven
	// over the fixture. A trailing sentinel guarantees a second block to delete.
	const doc = parse(ctx.fixture + '\n\nundo sentinel\n');
	const { deps } = createHeadlessActions(doc.children);
	const controller = createUndoController(deps);
	const blockEdit = createBlockEditActions(deps, controller);
	const before = deps.undoManager.getStacks().undo.length;
	await blockEdit.deleteBlock(0);
	const after = deps.undoManager.getStacks().undo.length;
	assertIs(
		after - before,
		1,
		`one structural op pushes exactly one undo entry over the "${ctx.kind}" fixture`
	);
	return { status: 'executed', detail: 'one structural op → one undo entry' };
}

function execClipboard(cell: ClosureCell, ctx: KindCellContext | null): CellResult {
	if (cell.mode === 'not-supported') return { status: 'exempt', detail: cell.reason };
	if (cell.mode === 'implemented') {
		return {
			status: 'boundary',
			detail: `kind-specific clipboard mechanism — supply a profile check or run it in the ${BROWSER_SWEEP}`
		};
	}
	if (!ctx)
		return {
			status: 'boundary',
			detail: `no conformanceFixture — copy runs in the ${BROWSER_SWEEP}`
		};
	if (ctx.nodePath.length !== 1) {
		return {
			status: 'boundary',
			detail:
				'nested kind — copied as part of its container; the enclosing container cell covers its bytes'
		};
	}
	checkCopyIsRawByteSlice(ctx.kind, ctx.fixture);
	return { status: 'executed', detail: 'copy is a raw byte slice (no synthesis)' };
}

// ── Exported executors (direct-drive for regression tests) ───────────────────

const CLIPBOARD_SENTINEL = '\n\nclipboard sentinel\n';

/**
 * Assert the DEFAULT copy ceremony over `kind`'s fixture is a pure raw byte slice
 * — the honest meaning of `clipboard: inherit-default`. A partial cross-block copy
 * that STARTS inside the kind's block and runs into a trailing sentinel must equal
 * the underlying raw slice, verbatim. A kind that synthesizes on copy (table's
 * rectangular sub-table, chrome-wrapper recovery) diverges and this throws — which
 * is exactly what would have caught `table.clipboard` falsely declared
 * `inherit-default`. Exported so a regression test can drive it against a kind the
 * runner would otherwise route to a custom check.
 */
export function checkCopyIsRawByteSlice(kind: AnyBlockKind, fixture: string): void {
	const doc = parse(fixture + CLIPBOARD_SENTINEL);
	assertIs(doc.children[0].kind, kind, `"${kind}" is the top-level copy subject`);
	const lastIndex = doc.children.length - 1;
	assert(lastIndex >= 1, 'fixture + sentinel yields a second block to copy across');
	const kindNode = doc.children[0];
	const sentinel = doc.children[lastIndex];
	const startOffset = displayLength(kindNode.raw) > 1 ? 1 : 0;
	const endOffset = displayLength(sentinel.raw);
	const start: SelectionPoint = { path: [0], offset: startOffset };
	const end: SelectionPoint = { path: [lastIndex], offset: endOffset };
	const copied = collectCrossBlockText(doc, start, end);
	const expected =
		kindNode.raw.slice(startOffset) + sentinel.leadingTrivia + sentinel.raw.slice(0, endOffset);
	assertIs(copied, expected, `"${kind}" copy is a raw byte slice — no kind-specific synthesis`);
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function rebuildRawOf(
	kind: AnyBlockKind,
	fixture: string,
	descriptor: BlockKindDescriptor
): string {
	const path = findFirstPathOfKind(parse(fixture), kind)!;
	const doc = parse(fixture);
	const node = nodeAtPath(doc, path);
	descriptor.rebuildRaw!(node);
	return node.raw;
}

function firstVisibleChar(raw: string): string | null {
	for (const ch of raw) {
		if (!/\s/.test(ch)) return ch;
	}
	return null;
}
