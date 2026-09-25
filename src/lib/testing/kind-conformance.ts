/**
 * The generic per-kind conformance battery, the runnable half of the closure table. Registering a
 * block kind enrolls it: one cell per `ClosureColumn`, taken from the kind's `closure` block and
 * its `conformanceFixture`. A cell runs only where headless code can observe what it checks;
 * everything else is recorded as `boundary` or `exempt`, never stubbed green. It works under any
 * runner: failures are plain `Error`s and nothing here imports one.
 */

import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import {
	displayLength,
	documentLineEnding,
	ownTrailingLineEnding,
	trimTrailingLineEnding,
	type LineEnding
} from '../core/lines';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import type { ClosureCell, ClosureColumn } from '../schema/closure';
import {
	getBlockKindDescriptor,
	type BlockKindDescriptor,
	type MergeRole
} from '../schema/block-kind-descriptor';
import { isMergeEligible } from '../schema/merge-rules';
import { isWholeBlockUnit } from '../schema/whole-block-unit';
import { collectCrossBlockText } from '../selection/clipboard-text';
import type { SelectionPoint } from '../selection/primitives';
import { createSelectionState } from '../selection/selection-state.svelte';
import { pathsEqual } from '../selection/path-math';
import { scanDocument } from '../search/document-scan';
import { compileMatcher } from '../search/matcher';
import { createBlockEditActions } from '../editor-actions/block-edit';
import { createUndoController } from '../editor-actions/commit/undo-controller';
import {
	assert,
	assertIs,
	assertReasonDocumented,
	assertRebuildIsParseCanonical,
	fail,
	findFirstPathOfKind,
	nodeAtPath,
	show
} from './conformance-core';
import { createHeadlessActions } from './headless-actions';
import { assertParseConverged } from './parse-convergence';
import { normalizeOwnRaw } from '../tree-operations/node-primitives';

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
	/** The leaf raw-write cell, run for every kind with a top-level fixture: a kind with no
	 *  `normalizeRawWrite` must survive its closing line cut, a declarer its three writes. */
	rawWrite: { status: KindCellStatus; detail: string };
}

/** The parsed fixture context a cell executor reads; absent without a `conformanceFixture`. */
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
 * Profile-supplied overrides. A column with a custom `check` runs it instead of the
 * generic executor, for a mechanism the runner cannot observe (table's rectangular copy).
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
 * Runs every headless closure cell for `kind`, or throws an `Error` naming each failed cell. A
 * `conformanceFixture` that parses to no node of the kind fails the run outright.
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
				assertReasonDocumented(result.detail, `${kind} ${column} exempt reason`);
			}
			cells.push({ column, mode: cell.mode, ...result });
		} catch (error) {
			failures.push(`${column}: ${(error as Error).message}`);
		}
	}

	let rawWrite: CellResult = { status: 'boundary', detail: 'not run' };
	try {
		rawWrite = execRawWrite(kind, descriptor, ctx);
	} catch (error) {
		failures.push(`rawWrite: ${(error as Error).message}`);
	}

	if (failures.length > 0) {
		fail(`kind conformance failed for "${kind}":\n  - ${failures.join('\n  - ')}`);
	}
	return { kind, cells, rawWrite };
}

function buildContext(kind: AnyBlockKind, descriptor: BlockKindDescriptor): KindCellContext | null {
	const fixture = descriptor.conformanceFixture;
	if (fixture === undefined) return null;
	const doc = parse(fixture);
	const nodePath = findFirstPathOfKind(doc, kind);
	if (!nodePath) {
		fail(`kind conformance failed for "${kind}": conformanceFixture parses to no "${kind}" node`);
	}
	// The one place every check receives the fixture, so the rule they all rely on, that the node
	// sits at `doc.children[0]`, is fixed here: undo deletes it, the byte-slice copy starts from it.
	if (nodePath[0] !== 0) {
		fail(
			`kind conformance failed for "${kind}": conformanceFixture must open with the "${kind}" ` +
				`block (found under top-level index ${nodePath[0]}) — the kit drives the fixture's first ` +
				`block and rides its own sentinel beside it`
		);
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
	// In any mode but `implemented` a custom check contradicts the declaration and would silence
	// the check that mode would run, so changing a profiled cell's mode back fails.
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
			return { status: 'boundary', detail: `native caret / focus policy: ${BROWSER_SWEEP}` };
		case 'selectionPaint':
			return { status: 'boundary', detail: `selection cover paint: ${BROWSER_SWEEP}` };
		case 'reorder':
			return execReorder(cell);
		case 'simOracle':
			return {
				status: 'boundary',
				detail:
					'note-taking simulation under the corruption checks: run by the platform sweep ' +
					'over the kinds it enrolls, never by this runner'
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
			detail: `no conformanceFixture: round-trip runs in the ${BROWSER_SWEEP}`
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
		assertRebuildIsParseCanonical(
			descriptor,
			nodeAtPath(parse(ctx.fixture), ctx.nodePath),
			`"${kind}"`
		);
		return {
			status: 'executed',
			detail:
				descriptor.containerContract === 'grid'
					? 'byte round-trip + rebuildRaw determinism'
					: 'byte round-trip + rebuildRaw parse-identity + determinism'
		};
	}
	return { status: 'executed', detail: 'byte round-trip' };
}

/**
 * An independent restatement of the merge-role → Backspace-merge table
 * (docs/design/editor.md); re-deriving it from `isMergeEligible` would be vacuous.
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
		return { status: 'boundary', detail: `search-match mark overlay: ${BROWSER_SWEEP}` };
	}
	if (!ctx) return { status: 'exempt', detail: cell.reason };
	const needle = firstVisibleChar(ctx.node.raw);
	if (needle === null) return { status: 'exempt', detail: cell.reason };
	const compiled = compileMatcher(needle, { caseSensitive: true, wholeWord: false, regex: false });
	if (!compiled.ok) return { status: 'exempt', detail: cell.reason };
	// The needle is present in the raw, so no match can only mean the search deliberately
	// skips this non-searchable kind.
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
		detail: `block reorder is an Alt+Arrow / drag gesture: ${BROWSER_SWEEP}`
	};
}

async function execUndo(cell: ClosureCell, ctx: KindCellContext | null): Promise<CellResult> {
	if (cell.mode === 'not-supported') return { status: 'exempt', detail: cell.reason };
	if (cell.mode === 'implemented') {
		return {
			status: 'boundary',
			detail: `kind-specific undo mechanism: supply a profile check or run it in the ${BROWSER_SWEEP}`
		};
	}
	if (!ctx)
		return {
			status: 'boundary',
			detail: `no conformanceFixture: undo depth runs in the ${BROWSER_SWEEP}`
		};

	const doc = parse(ctx.fixture + '\n\nundo sentinel\n');
	assert(
		doc.children.length > 1,
		`the kit's trailing sentinel parses beside the "${ctx.kind}" fixture rather than being ` +
			`swallowed by it, so there is a second block to delete`
	);
	const { deps } = createHeadlessActions(doc);
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
			detail: `kind-specific clipboard mechanism: supply a profile check or run it in the ${BROWSER_SWEEP}`
		};
	}
	if (!ctx)
		return {
			status: 'boundary',
			detail: `no conformanceFixture: copy runs in the ${BROWSER_SWEEP}`
		};
	if (ctx.nodePath.length !== 1) {
		return {
			status: 'boundary',
			detail:
				'nested kind: copied as part of its container; the enclosing container cell covers its bytes'
		};
	}
	checkCopyIsRawByteSlice(ctx.kind, ctx.fixture);
	return { status: 'executed', detail: 'copy is a raw byte slice (no synthesis)' };
}

function execRawWrite(
	kind: AnyBlockKind,
	descriptor: BlockKindDescriptor,
	ctx: KindCellContext | null
): CellResult {
	const hasTopLevelFixture = ctx !== null && ctx.nodePath.length === 1;
	if (!descriptor.normalizeRawWrite) {
		if (!hasTopLevelFixture) {
			return {
				status: 'exempt',
				detail: 'declares no normalizeRawWrite and has no top-level conformanceFixture to cut'
			};
		}
		checkClosingCutNeedsNoRule(kind, ctx.fixture);
		return {
			status: 'executed',
			detail:
				'declares no normalizeRawWrite, and the closing line cut leaves the next block its own'
		};
	}
	if (!hasTopLevelFixture) {
		return {
			status: 'boundary',
			detail: 'declares normalizeRawWrite but has no top-level conformanceFixture to write over'
		};
	}
	checkLeafRawWrite(kind, ctx.fixture);
	return {
		status: 'executed',
		detail: 'three truncating writes, each idempotent and leaving the next block its own'
	};
}

// ── Exported executors (direct-drive for regression tests) ───────────────────

const TRAILING_SENTINEL = '\n\nclipboard sentinel\n';
const LEADING_SENTINEL = 'clipboard lead\n\n';

/**
 * Asserts that the default cross-block copy over `kind`'s fixture carries its bytes with nothing
 * synthesized for the kind, at both endpoint roles, which is what `clipboard: inherit-default`
 * honestly means. The endpoints go through the real selection code, so the expectation states the
 * contract rather than recomputing the slice under test. The fixture parses to `kind` at
 * `children[0]`, and the kit adds its marker block on the side the copy sweeps across.
 */
export function checkCopyIsRawByteSlice(kind: AnyBlockKind, fixture: string): void {
	assertIs(
		parse(fixture).children[0]?.kind,
		kind,
		`"${kind}" is the top-level copy subject: a conformanceFixture must parse to its kind ` +
			`at children[0], and the kit adds its own sentinel block on the sweeping side`
	);
	checkCopyFromKind(kind, fixture);
	checkCopyIntoKind(kind, fixture);
}

/** The kind as the start of the range: its tail, then the sentinel's head. */
function checkCopyFromKind(kind: AnyBlockKind, fixture: string): void {
	const doc = parse(fixture + TRAILING_SENTINEL);
	const lastIndex = doc.children.length - 1;
	assert(lastIndex >= 1, 'fixture + sentinel yields a second block to copy across');
	const kindNode = doc.children[0];
	const sentinel = doc.children[lastIndex];
	const startOffset = interiorOffset(kindNode);
	const endOffset = displayLength(sentinel.raw);
	const copied = copyThroughFunnel(
		doc,
		{ path: [0], offset: startOffset },
		{ path: [lastIndex], offset: endOffset }
	);
	const tail = isWholeBlockUnit(kindNode) ? kindNode.raw : kindNode.raw.slice(startOffset);
	assertIs(
		copied,
		tail +
			bytesBetween(doc.children, 1, lastIndex) +
			sentinel.leadingTrivia +
			sentinel.raw.slice(0, endOffset),
		`"${kind}" copy is a raw byte slice — no kind-specific synthesis`
	);
}

/** The kind as the end of the range, the role a start-only check never exercises. */
function checkCopyIntoKind(kind: AnyBlockKind, fixture: string): void {
	const doc = parse(LEADING_SENTINEL + fixture);
	const kindIndex = doc.children.length - 1;
	assert(kindIndex >= 1, 'sentinel + fixture yields a block to copy across from');
	const sentinel = doc.children[0];
	const kindNode = doc.children[kindIndex];
	const startOffset = interiorOffset(sentinel);
	const copied = copyThroughFunnel(
		doc,
		{ path: [0], offset: startOffset },
		{ path: [kindIndex], offset: interiorOffset(kindNode) }
	);
	const head = isWholeBlockUnit(kindNode)
		? trimTrailingLineEnding(kindNode.raw)
		: kindNode.raw.slice(0, interiorOffset(kindNode));
	assertIs(
		copied,
		sentinel.raw.slice(startOffset) +
			bytesBetween(doc.children, 1, kindIndex) +
			kindNode.leadingTrivia +
			head,
		`"${kind}" copy is a raw byte slice — no kind-specific synthesis`
	);
}

/** The blocks a sweep crosses whole: a blank run beside the sentinel materializes as these. */
function bytesBetween(children: CstNode[], from: number, to: number): string {
	return children
		.slice(from, to)
		.map((node) => node.leadingTrivia + node.raw)
		.join('');
}

/**
 * The production create, store and slice chain: the endpoints are normalized in `SelectionState`
 * exactly as a real gesture's would be, so a kind whose offsets that code rewrites is copied the
 * way the editor copies it.
 */
function copyThroughFunnel(doc: Document, anchor: SelectionPoint, focus: SelectionPoint): string {
	const selection = createSelectionState({ getDoc: () => doc });
	selection.enterCrossBlock(anchor, focus);
	const { start, end } = selection;
	if (!start || !end) fail('the selection funnel refused the cross-block endpoint pair');
	return collectCrossBlockText(doc, start, end);
}

/** An offset strictly inside the block, so a kind that snaps its endpoints is seen doing it. */
function interiorOffset(node: CstNode): number {
	return displayLength(node.raw) > 1 ? 1 : 0;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function rebuildRawOf(
	kind: AnyBlockKind,
	fixture: string,
	descriptor: BlockKindDescriptor
): string {
	const doc = parse(fixture);
	const node = nodeAtPath(doc, findFirstPathOfKind(doc, kind)!);
	descriptor.rebuildRaw!(node);
	return node.raw;
}

function firstVisibleChar(raw: string): string | null {
	for (const ch of raw) {
		if (!/\s/.test(ch)) return ch;
	}
	return null;
}

const RAW_WRITE_SENTINEL = 'raw write sentinel\n';

function fixtureLines(fixture: string) {
	const ending = ownTrailingLineEnding(fixture) || '\n';
	const lines = trimTrailingLineEnding(fixture).split(ending);
	return { ending, lines, closingCut: lines.slice(0, -1).join(ending) + ending };
}

/**
 * For a kind with no `normalizeRawWrite`: the fixture with its closing line cut must not absorb
 * the block after it, or a range delete over the closer turns the document below into its body.
 */
function checkClosingCutNeedsNoRule(kind: AnyBlockKind, fixture: string): void {
	const { ending, closingCut } = fixtureLines(fixture);
	const following = parse(closingCut + ending + RAW_WRITE_SENTINEL).children.at(-1);
	if (following?.raw === RAW_WRITE_SENTINEL) return;
	fail(
		`"${kind}" declares no normalizeRawWrite, and the closing line cut (${show(closingCut)}) ` +
			`swallows the next block (${show(RAW_WRITE_SENTINEL)}): declare normalizeRawWrite to ` +
			`put the closer back`
	);
}

/**
 * Drives three truncating writes over `kind`'s fixture through its `normalizeRawWrite` rule: the
 * closing line cut, everything past the first line cut, and an empty write. Each result must be
 * a fixed point of the rule and must not absorb the block after it; a write that leaves the
 * block's first line and body keeps the kind, written in place with the document converged.
 */
export function checkLeafRawWrite(
	kind: AnyBlockKind,
	fixture: string,
	normalize: (node: NodeView, raw: string, lineEnding: LineEnding) => string = normalizeOwnRaw
): void {
	const { ending, lines, closingCut } = fixtureLines(fixture);
	const writes: Array<[label: string, raw: string, keepsKind: boolean]> = [
		['the closing line cut', closingCut, lines.length > 2],
		['everything past the first line cut', lines[0] + ending, false],
		['an empty write', '', false]
	];
	for (const [label, written, keepsKind] of writes) {
		const doc = parse(fixture + ending + RAW_WRITE_SENTINEL);
		const node = doc.children[0];
		assertIs(node?.kind, kind, `"${kind}" fixture opens with the kind`);
		const lineEnding = documentLineEnding(doc);
		const legal = normalize(node, written, lineEnding);
		assertIs(normalize(node, legal, lineEnding), legal, `"${kind}" rule is idempotent on ${label}`);

		const following = parse(legal + ending + RAW_WRITE_SENTINEL).children.at(-1);
		assertIs(
			following?.raw,
			RAW_WRITE_SENTINEL,
			`"${kind}" after ${label} (${show(legal)}) leaves the next block its own`
		);
		if (!keepsKind) continue;

		const reparsed = parse(legal).children;
		assertIs(reparsed[0]?.kind, kind, `"${kind}" stays its kind after ${label}`);
		node.raw = legal;
		node.metadata = reparsed[0].metadata;
		assertParseConverged(doc, `"${kind}" written in place after ${label}`);
	}
}
