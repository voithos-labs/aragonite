/**
 * Per-kind block-opener registry: the parser's dispatch order and the paragraph-interrupt scan
 * both derive from these declarations, so a registered opener is automatically in both.
 * Paragraph is the unregistered total fallback; setext headings and tables emerge from its
 * continuation scan, not from openers.
 */

import { isBuiltinBlockKind, type AnyBlockKind, type CstNode } from '../core/nodes';
import type { ParsedLine } from '../core/lines';
import {
	enqueueRegistrationCheck,
	hasPendingRegistrationChecks,
	markGrammarConsumed,
	__resetRegistrationChecksForTests
} from './registration-pending';
import { flushPendingRegistrationChecks } from './registration-checks';
import { registerOnce } from './register-once';

/** Minted fresh per block and read synchronously; never a handle to keep past the return. */
export interface OpenContext {
	lines: ParsedLine[];
	index: number;
	end: number;
	/** The line at `index`, precomputed once per dispatch. */
	line: ParsedLine;
	/** Blank-line bytes folded above this block: non-empty is the "preceded by blank" interrupt context (GFM §4.4). */
	leadingTrivia: string;
	/** True when this parse entry was given a whole document (`parse` scope `'document'`), false for one block's bytes read standalone. Constant through nested container recursion, so a document-position gate composes it with `index`/`depth`/`leadingTrivia`. */
	isDocumentParse: boolean;
	/** Container-nesting depth of this parse level (0 at the document root). A container opener that reparses its body recurses at `depth + 1`; the cap (`MAX_NESTING_DEPTH`) folds deeper input into paragraph content. */
	depth: number;
	/**
	 * The instance seam over the global openers. Nested container reparses create their own
	 * context and default to the global grammar (the enablement boundary — see `parse`).
	 */
	grammar: GrammarView;
}

/**
 * A claim on the lines starting at `ctx.index`. `consumed` is a count, not a resume position,
 * and must be >= 1 — claiming nothing would spin the parse loop, so the dispatch declines it.
 */
export interface BlockOpenerResult {
	node: CstNode;
	consumed: number;
}

export interface BlockOpener {
	priority: number;
	/** Attempt to open this kind at ctx.index; null declines. */
	tryOpen(ctx: OpenContext): BlockOpenerResult | null;
	/** Whether a line of this kind interrupts an open paragraph (GFM continuation rules); `false` = never. */
	interruptsParagraph: ((lineText: string) => boolean) | false;
}

const openers = new Map<AnyBlockKind, BlockOpener>();
let orderedEntriesCache: [AnyBlockKind, BlockOpener][] | null = null;
let orderedCache: BlockOpener[] | null = null;
let interruptCache: ((lineText: string) => boolean)[] | null = null;

function invalidateGrammarCaches(): void {
	orderedEntriesCache = null;
	orderedCache = null;
	interruptCache = null;
}

export function registerBlockOpener(kind: AnyBlockKind, opener: BlockOpener): void {
	registerOnce(
		openers.has(kind),
		() => {
			openers.set(kind, opener);
			enqueueRegistrationCheck(kind, 'opener');
			invalidateGrammarCaches();
		},
		`registerBlockOpener: "${kind}" is already registered. Openers are register-once.`
	);
}

/**
 * Probe whether an opener is registered — `registerBlockOpener` throws on duplicate, so a
 * plugin registering idempotently (HMR / re-import) guards on this. Takes a plain name.
 */
export function isBlockOpenerRegistered(kind: string): boolean {
	return openers.has(kind as AnyBlockKind);
}

/** A per-instance enablement predicate: `true` keeps the kind's opener in the grammar. */
export type OpenerEnablement = (kind: AnyBlockKind) => boolean;

// Priority-ascending, ties broken by kind name: dispatch order is a pure function of the
// declarations, never of registration order.
function orderedEntries(): readonly [AnyBlockKind, BlockOpener][] {
	if (!orderedEntriesCache) {
		orderedEntriesCache = [...openers.entries()].sort(
			([kindA, a], [kindB, b]) =>
				a.priority - b.priority || (kindA < kindB ? -1 : kindA > kindB ? 1 : 0)
		);
	}
	return orderedEntriesCache;
}

/**
 * The parser's dispatch order (G1.10 warns on a priority tie). The grammar-consumption seam:
 * pending registrations are validated before this read, and flush-before-mark keeps a registrant
 * racing the first read out of the late-opener warn (G1.17). `isEnabled` filters plugin kinds
 * per instance; absent = all definitions, cached. Built-ins are never filtered.
 */
export function getOrderedOpeners(isEnabled?: OpenerEnablement): readonly BlockOpener[] {
	if (hasPendingRegistrationChecks()) flushPendingRegistrationChecks();
	markGrammarConsumed();
	if (isEnabled) {
		return orderedEntries()
			.filter(([kind]) => isEnabled(kind))
			.map(([, opener]) => opener);
	}
	if (!orderedCache) orderedCache = orderedEntries().map(([, opener]) => opener);
	return orderedCache;
}

/**
 * Registry-derived paragraph-interrupt check, carrying the same seam duties as
 * `getOrderedOpeners`. NOT enablement-filtered: the parsers call it directly rather than
 * through a GrammarView, so the interrupt scan is the global-grammar boundary.
 */
export function lineInterruptsParagraph(lineText: string): boolean {
	if (hasPendingRegistrationChecks()) flushPendingRegistrationChecks();
	markGrammarConsumed();
	if (!interruptCache) {
		interruptCache = [...openers.values()]
			.map((o) => o.interruptsParagraph)
			.filter((p): p is (lineText: string) => boolean => p !== false);
	}
	for (const predicate of interruptCache) {
		if (predicate(lineText)) return true;
	}
	return false;
}

/**
 * The grammar as a per-instance resolution object over the global openers, threaded by
 * `parse(source, { grammar })`. Only the opener dispatch is instance-resolved; the
 * paragraph-interrupt scan stays on the global-grammar boundary.
 */
export interface GrammarView {
	orderedOpeners(): readonly BlockOpener[];
}

export const defaultGrammarView: GrammarView = {
	orderedOpeners: () => getOrderedOpeners()
};

// TODO(limestone): the filtered read re-sorts per call where the default view is cached.
// Memoize per-view with registration-invalidation before the public enablement API ships.
export function createGrammarView(isEnabled: OpenerEnablement): GrammarView {
	return {
		orderedOpeners: () => getOrderedOpeners(isEnabled)
	};
}

// ── Outer block starts ──────────────────────────────────────────────────

/** What a line means at the outer level, which turns on whether a paragraph is open above it. */
export interface OuterBlockScan {
	/** A lazy continuation: an open paragraph absorbs the starts §4.4 forbids from interrupting. */
	paragraphOpen: boolean;
	/** Defaults to the global openers, the boundary `lineInterruptsParagraph` also reads. */
	grammar?: GrammarView;
}

/**
 * Does `line` start a block at the outer level? cmark-gfm ends both a lazy continuation and a
 * table's row scan there, and the paragraph-interrupt exceptions do not apply. Two claims are
 * transparent: a link reference definition is carved out of a paragraph at finalize rather than
 * opened as a block, and indented code cannot open while a paragraph is open to absorb the line.
 */
export function lineStartsOuterBlock(line: ParsedLine, scan: OuterBlockScan): boolean {
	const grammar = scan.grammar ?? defaultGrammarView;
	const probe: OpenContext = {
		lines: [line],
		index: 0,
		end: 1,
		line,
		leadingTrivia: '',
		isDocumentParse: false,
		// Depth-free by design: the verdict is which kind CLAIMS the line at the outer level, and
		// depth only moves the nesting cap and the body parse under the claim, never the claim.
		depth: 0,
		grammar
	};
	for (const opener of grammar.orderedOpeners()) {
		const claim = opener.tryOpen(probe);
		if (claim) return claimOpensBlock(claim.node.kind, scan.paragraphOpen);
	}
	return false;
}

function claimOpensBlock(kind: AnyBlockKind, paragraphOpen: boolean): boolean {
	if (kind === 'linkReferenceDefinition') return false;
	return !(paragraphOpen && kind === 'indentedCode');
}

/** Registry introspection for the invariant guard (G1.10). */
export function listRegisteredOpeners(): { kind: AnyBlockKind; priority: number }[] {
	return [...openers.entries()].map(([kind, o]) => ({ kind, priority: o.priority }));
}

// Also resets the registration-check latches: a latch outliving the registry it shadows would
// mislabel the next controlled set as late registrations.
export function __resetBlockOpenersForTests(): void {
	openers.clear();
	invalidateGrammarCaches();
	__resetRegistrationChecksForTests();
}

// The unified schema reset preserves built-ins for tests that merely add plugin kinds.
export function __removePluginOpenersForTests(): void {
	for (const kind of openers.keys()) {
		if (!isBuiltinBlockKind(kind)) openers.delete(kind);
	}
	invalidateGrammarCaches();
}
