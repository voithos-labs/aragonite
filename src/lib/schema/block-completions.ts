/**
 * Per-kind Enter-completion registry, the block-opener registry's sibling: an opener recognizes
 * a line while parsing, a completer recognizes a lone typed line at an Enter press and answers
 * the canonical lines that complete it. Published on `plugin.ts`, so its plugin entries clear
 * through `registry-reset.ts` like every other public register-once seam.
 */

import { isBuiltinBlockKind, type AnyBlockKind } from '../core/nodes';
import { deletePluginEntries, registerOnce } from './register-once';

/**
 * The replacement, as lines WITHOUT endings — the seam attaches the block's own (G4.20) — plus
 * where the caret seats: `path` is child indices inside the minted block, empty for the block,
 * and `line`/`column` address a position inside THAT node. Line-relative rather than a byte
 * offset because the seam picks the line ending after the claim, so only it can count bytes.
 */
export interface CompletionResult {
	lines: string[];
	caret: { path: number[]; line: number; column: number };
}

export interface BlockCompleter {
	/** Attempt to complete `line`; null declines, as does a claim whose lines would paint nothing. */
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

/** Whether `kind` already owns a completer — the probe a registrar re-run reads before it
 *  registers, so a re-installed plugin never trips the register-once throw. */
export function isBlockCompleterRegistered(kind: string): boolean {
	return completers.has(kind as AnyBlockKind);
}

export function __resetBlockCompletersForTests(): void {
	completers.clear();
	orderedCache = null;
}

// The unified schema reset preserves built-ins for tests that merely add plugin kinds.
export function __removePluginCompletersForTests(): void {
	deletePluginEntries(completers, isBuiltinBlockKind);
	orderedCache = null;
}
