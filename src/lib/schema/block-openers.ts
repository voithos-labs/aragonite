/**
 * Per-kind block-opener registry: the parser's dispatch order and the paragraph-interrupt scan
 * both come from these declarations, so registering an opener puts it in both. Paragraph is the
 * fallback and has no opener; setext headings and tables come out of its continuation scan.
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
import { deletePluginEntries, registerOnce } from './register-once';

/** Created fresh for each block and read synchronously; never keep it past the call. */
export interface OpenContext {
	lines: ParsedLine[];
	index: number;
	end: number;
	/** The line at `index`, precomputed once per dispatch. */
	line: ParsedLine;
	/** The blank-line bytes above this block: non-empty means a blank line precedes it, which the interrupt rules read (GFM §4.4). */
	leadingTrivia: string;
	/** True when this parse was given a whole document (`parse` scope `'document'`), false when one block's bytes are parsed on their own. It stays the same through nested container parsing, so a check that depends on document position combines it with `index`/`depth`/`leadingTrivia`. */
	isDocumentParse: boolean;
	/** Container-nesting depth of this parse level (0 at the document root). A container opener that reparses its body recurses at `depth + 1`; past the cap (`MAX_NESTING_DEPTH`) deeper input becomes paragraph content. */
	depth: number;
	/**
	 * The per-editor view of the global openers. A nested container reparse builds its own
	 * context and falls back to the global grammar, so per-instance enablement stops there
	 * (see `parse`).
	 */
	grammar: GrammarView;
}

/**
 * What an opener returns for the lines starting at `ctx.index`. `consumed` is a line count, not
 * a resume position, and must be at least 1: taking no line would spin the parse loop, so the
 * parser rejects that result.
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
 * Is an opener registered? `registerBlockOpener` throws on a duplicate, so a plugin that may
 * register twice (hot reload, re-import) checks this first. Takes a plain name.
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
 * The parser's dispatch order (G1.10 warns when two kinds share a priority). Reads through
 * `consumedEntries`, so pending registrations are checked first. `isEnabled` filters plugin
 * kinds per editor; without it every registered opener comes back, cached. Built-ins are never
 * filtered.
 */
export function getOrderedOpeners(isEnabled?: OpenerEnablement): readonly BlockOpener[] {
	const entries = consumedEntries();
	if (isEnabled) return entries.filter(([kind]) => isEnabled(kind)).map(([, opener]) => opener);
	if (!orderedCache) orderedCache = entries.map(([, opener]) => opener);
	return orderedCache;
}

// Every ordered read goes through here: pending registrations are checked before the read, and
// marking the grammar used only afterwards keeps a registration that races the first read out of
// the late-opener warning (G1.17).
function consumedEntries(): readonly [AnyBlockKind, BlockOpener][] {
	if (hasPendingRegistrationChecks()) flushPendingRegistrationChecks();
	markGrammarConsumed();
	return orderedEntries();
}

/**
 * Paragraph-interrupt check built from the registry, handling pending registrations the way
 * `getOrderedOpeners` does. Not filtered by enablement: the parsers call it directly rather
 * than through a `GrammarView`, so the interrupt scan always uses the global grammar.
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
 * A per-editor view of the global openers, passed in as `parse(source, { grammar })`. Only the
 * opener dispatch is resolved per editor; the paragraph-interrupt scan always uses the global
 * grammar.
 */
export interface GrammarView {
	orderedOpeners(): readonly BlockOpener[];
}

export const defaultGrammarView: GrammarView = {
	orderedOpeners: () => getOrderedOpeners()
};

export function createGrammarView(isEnabled: OpenerEnablement): GrammarView {
	// A reparse reads this once per block, so the filtered list is cached against the global
	// ordering array: a later registration replaces that array, which rebuilds the filter.
	let builtFrom: readonly [AnyBlockKind, BlockOpener][] | null = null;
	let filtered: readonly BlockOpener[] = [];
	return {
		orderedOpeners() {
			const entries = consumedEntries();
			if (entries !== builtFrom) {
				builtFrom = entries;
				filtered = entries.filter(([kind]) => isEnabled(kind)).map(([, opener]) => opener);
			}
			return filtered;
		}
	};
}

// ── Outer block starts ──────────────────────────────────────────────────

/** What a line means at the outer level, which turns on whether a paragraph is open above it. */
export interface OuterBlockScan {
	/** A lazy continuation: an open paragraph absorbs the block starts §4.4 forbids from interrupting. */
	paragraphOpen: boolean;
	/** Defaults to the global openers, the same set `lineInterruptsParagraph` reads. */
	grammar?: GrammarView;
}

/**
 * Does `line` start a block at the outer level? cmark-gfm ends both a lazy continuation and a
 * table's row scan there, and the paragraph-interrupt exceptions do not apply. Two kinds do not
 * count as a start: a link reference definition is cut out of a paragraph when the paragraph
 * ends, and indented code cannot open while a paragraph is open to absorb the line.
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
		// Always 0 on purpose: the question is which kind opens at the outer level, and depth only
		// moves the nesting cap and the body parse below, never which kind opens.
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

/** Lets the dev-mode check for duplicate priorities (G1.10) read the registry. */
export function listRegisteredOpeners(): { kind: AnyBlockKind; priority: number }[] {
	return [...openers.entries()].map(([kind, o]) => ({ kind, priority: o.priority }));
}

// Also resets the registration-check flags: a flag left behind by the cleared registry would
// make the next set of registrations look late.
export function __resetBlockOpenersForTests(): void {
	openers.clear();
	invalidateGrammarCaches();
	__resetRegistrationChecksForTests();
}

// The shared schema reset keeps built-ins, for tests that only add plugin kinds.
export function __removePluginOpenersForTests(): void {
	deletePluginEntries(openers, isBuiltinBlockKind);
	invalidateGrammarCaches();
}
