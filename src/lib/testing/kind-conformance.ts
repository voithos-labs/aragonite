/**
 * The generic per-kind conformance battery: registering a block kind enrolls it, one cell per
 * `ClosureColumn` plus the raw-write cell, read from its descriptor and `conformanceFixture`. A
 * cell runs only where headless code can observe what it checks; the rest is reported `boundary`
 * or `exempt`, never stubbed green.
 */

import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import {
	displayLength,
	documentLineEnding,
	ownTrailingLineEnding,
	trimTrailingLineEnding
} from '../core/lines';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { CLOSURE_COLUMNS, type ClosureCell, type ClosureColumn } from '../schema/closure';
import {
	getBlockKindDescriptor,
	isGridDescriptor,
	type BlockKindDescriptor,
	type MergeRole,
	type WriteRule
} from '../schema/block-kind-descriptor';
import { isMergeEligible } from '../schema/merge-rules';
import { isWholeBlockUnit } from '../schema/whole-block-unit';
import { collectCrossBlockText } from '../selection/clipboard-text';
import { coverRange } from '../selection/range-coverage';
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
	assertRebuildIsParseCanonical,
	fail,
	nodeAtPath,
	runCells,
	show,
	subjectNode,
	subjectPath,
	type CellOutcome,
	type CellReport,
	type KitCell
} from './conformance-core';
import { installOwnRaw } from '../tree-operations/node-primitives';
import { defaultGrammarView } from '../schema/block-openers';
import { createHeadlessActions } from './headless-actions';
import { assertParseConverged } from './parse-convergence';

// ── Report + profile ─────────────────────────────────────────────────────────

/** A closure column, plus `rawWrite`, which reads the descriptor rather than the closure block. */
export type KindCell = ClosureColumn | 'rawWrite';

export interface KindCellReport extends CellReport<KindCell> {
	/** The closure mode the kind declared for the cell; absent on `rawWrite`. */
	mode?: ClosureCell['mode'];
}

export interface KindConformanceReport {
	kind: AnyBlockKind;
	cells: KindCellReport[];
}

/** The parsed fixture context a cell executor reads; absent without a `conformanceFixture`. */
export interface KindCellContext {
	kind: AnyBlockKind;
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

interface KindRun {
	kind: AnyBlockKind;
	descriptor: BlockKindDescriptor;
	parsed: KindCellContext | null;
}

/**
 * Runs every headless closure cell for `kind`, or throws an `Error` naming each failed cell. A
 * `conformanceFixture` that parses to no node of the kind fails the run outright.
 */
export async function runKindConformance(
	kind: AnyBlockKind,
	profile: KindConformanceProfile = {}
): Promise<KindConformanceReport> {
	const descriptor = getBlockKindDescriptor(kind);
	const run: KindRun = { kind, descriptor, parsed: buildContext(kind, descriptor) };
	const columns = Object.keys(CLOSURE_COLUMNS) as ClosureColumn[];
	const cells: KitCell<KindCell, KindRun>[] = [
		...columns.map((column) => {
			const custom = profile.cells?.[column]?.check;
			return {
				cell: column,
				run: custom
					? () => runCustomCheck(column, custom, run)
					: () => executeCell(column, descriptor.closure[column], run)
			};
		}),
		{ cell: 'rawWrite', run: execRawWrite }
	];
	const reports = await runCells(cells, run, {
		subject: kind,
		heading: `kind conformance failed for "${kind}"`
	});
	return {
		kind,
		cells: reports.map((report) =>
			report.cell === 'rawWrite'
				? report
				: { ...report, mode: descriptor.closure[report.cell].mode }
		)
	};
}

function buildContext(kind: AnyBlockKind, descriptor: BlockKindDescriptor): KindCellContext | null {
	const fixture = descriptor.conformanceFixture;
	if (fixture === undefined) return null;
	const doc = parse(fixture);
	const nodePath = subjectPath(
		doc,
		kind,
		'first',
		`kind conformance failed for "${kind}": conformanceFixture`
	);
	// Every check receives the fixture here, so the rule they rely on (the node at
	// `doc.children[0]`) is enforced once: undo deletes it and the byte-slice copy starts from it.
	if (nodePath[0] !== 0) {
		fail(
			`kind conformance failed for "${kind}": conformanceFixture must open with the "${kind}" ` +
				`block (found under top-level index ${nodePath[0]}) — the kit drives the fixture's first ` +
				`block and rides its own sentinel beside it`
		);
	}
	return { kind, fixture, doc, node: nodeAtPath(doc, nodePath), nodePath };
}

async function runCustomCheck(
	column: ClosureColumn,
	check: KindCellCheck['check'],
	{ kind, descriptor, parsed }: KindRun
): Promise<CellOutcome> {
	const mode = descriptor.closure[column].mode;
	// In any mode but `implemented` a custom check contradicts the declaration and would silence
	// the check that mode would run, so changing a profiled cell's mode back fails.
	if (mode !== 'implemented') {
		fail(
			`profile supplies a "${column}" check for "${kind}", but its declared mode is ` +
				`"${mode}" — a custom check is only valid on an 'implemented' cell`
		);
	}
	if (!parsed) {
		fail(
			`profile supplies a "${column}" check but "${kind}" has no conformanceFixture to run it over`
		);
	}
	await check(parsed);
	return 'profile custom check';
}

// ── Cell executors ─────────────────────────────────────────────────────────

const BROWSER_SWEEP = 'browser cell — executed in the browser sweep';

async function executeCell(
	column: ClosureColumn,
	cell: ClosureCell,
	{ kind, descriptor, parsed: ctx }: KindRun
): Promise<CellOutcome> {
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
): CellOutcome {
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
		const first = rebuildRawOf(ctx, descriptor);
		const second = rebuildRawOf(ctx, descriptor);
		assertIs(first, second, `"${kind}" rebuildRaw is deterministic`);
		assertRebuildIsParseCanonical(descriptor, freshSubject(ctx), `"${kind}"`);
		return isGridDescriptor(descriptor)
			? 'byte round-trip + rebuildRaw determinism'
			: 'byte round-trip + rebuildRaw parse-identity + determinism';
	}
	return 'byte round-trip';
}

/** An independent restatement of the merge-role table (`docs/design/editor.md` § Merge
 *  eligibility: roles, not pairs); derived from `isMergeEligible` it would test nothing. */
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

function execMergeBackspace(kind: AnyBlockKind, role: MergeRole): CellOutcome {
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
	return `mergeRole=${role} eligibility`;
}

function execSearchPaint(cell: ClosureCell, ctx: KindCellContext | null): CellOutcome {
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
	return 'document scan finds no match (degradation)';
}

function execReorder(cell: ClosureCell): CellOutcome {
	if (cell.mode === 'not-supported') return { status: 'exempt', detail: cell.reason };
	return {
		status: 'boundary',
		detail: `block reorder is an Alt+Arrow / drag gesture: ${BROWSER_SWEEP}`
	};
}

async function execUndo(cell: ClosureCell, ctx: KindCellContext | null): Promise<CellOutcome> {
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
	// Block 0 is the one deleted, so the kind has to still sit under it with the sentinel added.
	subjectPath(doc, ctx.kind, ctx.nodePath, 'conformanceFixture with the undo sentinel');
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
	return 'one structural op → one undo entry';
}

function execClipboard(cell: ClosureCell, ctx: KindCellContext | null): CellOutcome {
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
	return 'copy is a raw byte slice (no synthesis)';
}

function execRawWrite({ kind, descriptor, parsed: ctx }: KindRun): CellOutcome {
	const hasTopLevelFixture = ctx !== null && ctx.nodePath.length === 1;
	if (!descriptor.rawWrite) {
		if (!hasTopLevelFixture) {
			return {
				status: 'exempt',
				detail: 'declares no rawWrite and has no top-level conformanceFixture to cut'
			};
		}
		checkClosingCutNeedsNoRule(kind, ctx.fixture);
		return 'declares no rawWrite, and the closing line cut leaves the next block its own';
	}
	if (!hasTopLevelFixture) {
		return {
			status: 'boundary',
			detail: 'declares rawWrite but has no top-level conformanceFixture to write over'
		};
	}
	checkLeafRawWrite(kind, ctx.fixture);
	return 'five writes, each idempotent, leaving the next block its own, caret map agreeing';
}

// ── Exported executors (direct-drive for regression tests) ───────────────────

const TRAILING_SENTINEL = '\n\nclipboard sentinel\n';
const LEADING_SENTINEL = 'clipboard lead\n\n';

/** Asserts the default cross-block copy over `kind`'s fixture is a raw byte slice at both endpoint
 *  roles, which is what `clipboard: inherit-default` means; the fixture opens with `kind`. */
export function checkCopyIsRawByteSlice(kind: AnyBlockKind, fixture: string): void {
	subjectNode(
		parse(fixture),
		kind,
		[0],
		`the copy fixture (a conformanceFixture must parse to its kind at children[0], and the kit ` +
			`adds its own sentinel block on the sweeping side)`
	);
	checkCopyFromKind(kind, fixture);
	checkCopyIntoKind(kind, fixture);
}

/** The kind as the start of the range: its tail, then the sentinel's head. */
function checkCopyFromKind(kind: AnyBlockKind, fixture: string): void {
	const doc = parse(fixture + TRAILING_SENTINEL);
	const lastIndex = doc.children.length - 1;
	assert(lastIndex >= 1, 'fixture + sentinel yields a second block to copy across');
	const kindNode = subjectNode(doc, kind, [0], 'the copy fixture');
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
	// Counted from the end, since a fixture may carry blocks after its kind.
	const kindIndex = doc.children.length - parse(fixture).children.length;
	assert(kindIndex >= 1, 'sentinel + fixture yields a block to copy across from');
	const sentinel = doc.children[0];
	const kindNode = subjectNode(doc, kind, [kindIndex], 'the copy fixture after the sentinel');
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

/** Copies through the production selection code, so a kind whose endpoints `SelectionState`
 *  normalizes is copied the way the editor copies it. */
function copyThroughFunnel(doc: Document, anchor: SelectionPoint, focus: SelectionPoint): string {
	const selection = createSelectionState({ getDoc: () => doc });
	selection.enterCrossBlock(anchor, focus);
	const { start, end } = selection;
	if (!start || !end) fail('the selection funnel refused the cross-block endpoint pair');
	return collectCrossBlockText(doc, coverRange(doc, start, end));
}

/** An offset strictly inside the block, so a kind that snaps its endpoints is seen doing it. */
function interiorOffset(node: CstNode): number {
	return displayLength(node.raw) > 1 ? 1 : 0;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** The kind's node in a fresh parse of the fixture, for a check that writes to it. */
function freshSubject(ctx: KindCellContext): CstNode {
	return subjectNode(parse(ctx.fixture), ctx.kind, ctx.nodePath, 'conformanceFixture');
}

function rebuildRawOf(ctx: KindCellContext, descriptor: BlockKindDescriptor): string {
	const node = freshSubject(ctx);
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
 * For a kind with no `rawWrite`: the fixture with its closing line cut must not absorb
 * the block after it, or a range delete over the closer turns the document below into its body.
 */
function checkClosingCutNeedsNoRule(kind: AnyBlockKind, fixture: string): void {
	const { ending, closingCut } = fixtureLines(fixture);
	const following = parse(closingCut + ending + RAW_WRITE_SENTINEL).children.at(-1);
	if (following?.raw === RAW_WRITE_SENTINEL) return;
	fail(
		`"${kind}" declares no rawWrite, and the closing line cut (${show(closingCut)}) ` +
			`swallows the next block (${show(RAW_WRITE_SENTINEL)}): declare rawWrite to ` +
			`put the closer back`
	);
}

/** Drives five writes over `kind`'s fixture through its `rawWrite` rule; each result must be a
 *  fixed point of the rule, leave the next block its own, and have an agreeing caret map. */
export function checkLeafRawWrite(
	kind: AnyBlockKind,
	fixture: string,
	rule: WriteRule | undefined = getBlockKindDescriptor(kind).rawWrite
): void {
	if (!rule) fail(`"${kind}" declares no rawWrite to drive`);
	const { ending, lines, closingCut } = fixtureLines(fixture);
	const writes: Array<[label: string, raw: string, keepsKind: boolean]> = [
		['the closing line cut', closingCut, lines.length > 2],
		['everything past the first line cut', lines[0] + ending, false],
		['an empty write', '', false]
	];
	if (lines.length > 1) {
		const closer = lines[lines.length - 1];
		const closerInBody = [lines[0], closer, ...lines.slice(1)];
		writes.push(
			['the first line cut', lines.slice(1).join(ending) + ending, false],
			['the closing line copied into the body', closerInBody.join(ending) + ending, false]
		);
	}
	for (const [label, written, keepsKind] of writes) {
		const doc = parse(fixture + ending + RAW_WRITE_SENTINEL);
		const node = subjectNode(doc, kind, [0], 'the rawWrite fixture');
		const ctx = { node, mode: 'literal', lineEnding: documentLineEnding(doc) } as const;
		const legal = rule.normalize(written, ctx);
		assertIs(rule.normalize(legal, ctx), legal, `"${kind}" rule is idempotent on ${label}`);
		checkCaretMap(`"${kind}" caret map on ${label}`, written, legal, (offset) =>
			rule.mapOffset(written, offset, ctx)
		);

		const following = parse(legal + ending + RAW_WRITE_SENTINEL).children.at(-1);
		assertIs(
			following?.raw,
			RAW_WRITE_SENTINEL,
			`"${kind}" after ${label} (${show(legal)}) leaves the next block its own`
		);
		if (!keepsKind) continue;

		const reparsed = parse(legal).children;
		assertIs(reparsed[0]?.kind, kind, `"${kind}" stays its kind after ${label}`);
		installOwnRaw(node, legal, defaultGrammarView);
		assertParseConverged(doc, `"${kind}" written in place after ${label}`);
	}
}

/** A caret map agrees with its rule when offsets stay ordered and in range, one before every
 *  change stays, and one after every change moves by the length the rule added or dropped. */
function checkCaretMap(
	label: string,
	written: string,
	legal: string,
	mapOffset: (offset: number) => number
): void {
	const shorter = Math.min(written.length, legal.length);
	let prefix = 0;
	while (prefix < shorter && written[prefix] === legal[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < shorter - prefix &&
		written[written.length - 1 - suffix] === legal[legal.length - 1 - suffix]
	) {
		suffix++;
	}
	const grown = legal.length - written.length;
	let previous = 0;
	for (let offset = 0; offset <= written.length; offset++) {
		const mapped = mapOffset(offset);
		const at = `${label} at ${offset} (${show(written)} to ${show(legal)})`;
		assert(mapped >= previous && mapped <= legal.length, `${at}: ${mapped} is out of order`);
		previous = mapped;
		if (written === legal || offset < prefix) {
			assertIs(mapped, offset, `${at} stays, since the rule changed nothing before it`);
		} else if (offset > written.length - suffix) {
			assertIs(mapped, offset + grown, `${at} moves by what the rule changed before it`);
		}
	}
}
