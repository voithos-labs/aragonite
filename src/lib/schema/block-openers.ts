/**
 * Per-kind block-opener registry: the parser's dispatch order and the
 * paragraph-interrupt scan both derive from these declarations, so a kind
 * (built-in or plugin) that registers an opener is automatically in both —
 * a forgotten interrupt registration was a silent round-trip bug when the
 * scan was a hand-maintained list. Paragraph is the unregistered total
 * fallback; setext headings and tables emerge from its continuation scan,
 * not from openers.
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

/**
 * Minted fresh per block and stable for that block's opener dispatch — an opener
 * reads it synchronously; it is not a long-lived handle to keep past the return.
 */
export interface OpenContext {
	lines: ParsedLine[];
	index: number;
	end: number;
	/** The line at `index`, precomputed once per dispatch. */
	line: ParsedLine;
	leadingTrivia: string;
	/** True for the first content block of a parse window. With `leadingTrivia`, the "preceded by blank" interrupt context (GFM §4.4). */
	isFirstInWindow: boolean;
	/** Container-nesting depth of this parse level (0 at the document root). A container opener that reparses its body recurses at `depth + 1`; the cap (`MAX_NESTING_DEPTH`) folds deeper input into paragraph content. */
	depth: number;
	/**
	 * The grammar this parse resolves through — the instance seam over the global
	 * openers. `parseBlocks` seeds it; the top-level dispatch reads it. Nested
	 * container reparses create their own context and default to the global
	 * grammar (the documented enablement boundary — see `parse`).
	 */
	grammar: GrammarView;
}

/**
 * A claim on the lines starting at `ctx.index`. `consumed` is a count, not a
 * position: an opener says how many lines it took, never where the parser should
 * resume. It must be >= 1 — claiming nothing is the one return that could spin the
 * parse loop, so the dispatch declines it (see `core/parser.ts`).
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
 * Probe by name whether an opener is registered. `registerBlockOpener` throws on
 * duplicate, so a plugin registering idempotently (HMR / re-import) guards on
 * this. Accepts a plain name so callers needn't pre-brand an unminted kind.
 */
export function isBlockOpenerRegistered(kind: string): boolean {
	return openers.has(kind as AnyBlockKind);
}

/** A per-instance enablement predicate: `true` keeps the kind's opener in the grammar. */
export type OpenerEnablement = (kind: AnyBlockKind) => boolean;

// Priority-ascending, equal priorities broken by kind name — dispatch order is a
// pure function of the declarations, never of registration order. Cached; both
// grammar reads derive from it (the mapped/filtered shapes are the leaf caches).
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
 * The parser's dispatch order (G1.10 still warns on a priority tie, since a shared
 * priority is usually unintended). Cached — the parser loops this per block. The
 * grammar-consumption seam: registrations pending since the last flush are
 * validated before this read, and flush-before-mark keeps a registrant racing the
 * first read out of the late-opener warn (G1.17).
 *
 * `isEnabled` is the per-instance enablement filter:
 * absent = all definitions (the editorless/behavior-preserving default, cached);
 * present = a fresh view dropping the disabled plugin kinds' openers. Built-ins are
 * never filtered — the predicate's domain is plugin kinds (the view enforces that).
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
 * Registry-derived paragraph-interrupt check. A grammar read like
 * getOrderedOpeners, so it carries the same seam duties (flush pending checks,
 * trip the grammar-consumed latch). NOT enablement-filtered: the interrupt scan is
 * the documented global-grammar boundary — the parsers call it directly, never
 * through the per-instance GrammarView, so a filter here would be parse-path-dead.
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
 * The grammar as a per-instance resolution object over the global openers — the
 * slot `parse(source, { grammar })` threads. The default reads the
 * global definitions verbatim (behavior-preserving); a filtered view carries an
 * instance's enablement predicate. Only the opener dispatch is instance-resolved;
 * the paragraph-interrupt scan stays on the global-grammar boundary.
 */
export interface GrammarView {
	orderedOpeners(): readonly BlockOpener[];
}

export const defaultGrammarView: GrammarView = {
	orderedOpeners: () => getOrderedOpeners()
};

// TODO(limestone): the filtered read is uncached — getOrderedOpeners(isEnabled)
// re-sorts+filters every call, so parsing an N-block doc under an ACTIVE filter is
// N re-sorts vs the cached O(1) default path. Harmless while enablement is
// harness-only (the default view is cached); memoize per-view with
// registration-invalidation before the public enablement API ships.
export function createGrammarView(isEnabled: OpenerEnablement): GrammarView {
	return {
		orderedOpeners: () => getOrderedOpeners(isEnabled)
	};
}

/** Registry introspection for the invariant guard (G1.10). */
export function listRegisteredOpeners(): { kind: AnyBlockKind; priority: number }[] {
	return [...openers.entries()].map(([kind, o]) => ({ kind, priority: o.priority }));
}

// Opener tests own the whole registry (register a controlled set after a full
// clear). Also resets the registration-check latches — a grammar-consumed or
// first-flush latch outliving the registry it shadows would mislabel the next
// controlled set as late registrations.
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
