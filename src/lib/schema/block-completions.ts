/**
 * Per-kind Enter-completion registry, the block-opener registry's sibling: an opener recognizes
 * a line while parsing, a completer recognizes a lone typed line at an Enter press and answers
 * the canonical lines that complete it. Internal — nothing here is exported from `plugin.ts`, so
 * it is a built-in registrar and owes `aragonite/testing` no reset seam.
 */

import type { AnyBlockKind } from '../core/nodes';
import { registerOnce } from './register-once';

/**
 * The replacement, as lines WITHOUT endings — the seam attaches the block's own (G4.20) — plus
 * where the caret seats: `path` is child indices inside the minted block, empty for the block.
 */
export interface CompletionResult {
	lines: string[];
	caret: { path: number[]; offset: number };
}

export interface BlockCompleter {
	/** Attempt to complete `line`; null declines. */
	tryComplete(line: string): CompletionResult | null;
}

const completers = new Map<AnyBlockKind, BlockCompleter>();
let orderedCache: BlockCompleter[] | null = null;

export function registerBlockCompleter(kind: AnyBlockKind, completer: BlockCompleter): void {
	registerOnce(
		completers.has(kind),
		() => {
			completers.set(kind, completer);
			orderedCache = null;
		},
		`registerBlockCompleter: "${kind}" is already registered. Completers are register-once.`
	);
}

// Kind-name order, so which completer is consulted first is a pure function of the declarations
// and never of registration order — the openers' rule, minus a priority no conflict has asked for.
function ordered(): readonly BlockCompleter[] {
	if (!orderedCache) {
		orderedCache = [...completers.entries()]
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([, completer]) => completer);
	}
	return orderedCache;
}

/** The first claim on `line`, or null when no registered completer takes it. */
export function completeTypedLine(line: string): CompletionResult | null {
	for (const completer of ordered()) {
		const claim = completer.tryComplete(line);
		if (claim) return claim;
	}
	return null;
}

export function __resetBlockCompletersForTests(): void {
	completers.clear();
	orderedCache = null;
}
