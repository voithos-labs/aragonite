/**
 * Unstable-public hook for plugin inline syntax. A recognizer owns a single
 * trigger character; the scanner consults the registry in its `default` arm
 * (scan/index.ts) only when a trigger is registered, so an empty registry
 * leaves inline parsing byte-identical to the built-in grammar.
 */

import type { InlineNode } from '../../nodes';

/**
 * Inspect `raw` at `pos` (the trigger) within `[pos, end)`. Return a node whose
 * `start === pos` and `end > pos` to claim `[start, end)` — `end` is the scan
 * advance — or `null` to leave the trigger as literal text.
 */
export type InlineSyntaxRecognizer = (raw: string, pos: number, end: number) => InlineNode | null;

const registry = new Map<string, InlineSyntaxRecognizer>();

export function registerInlineSyntax(trigger: string, recognizer: InlineSyntaxRecognizer): void {
	if (trigger.length !== 1) {
		throw new Error('registerInlineSyntax: trigger must be a single character');
	}
	if (registry.has(trigger)) {
		throw new Error(`registerInlineSyntax: "${trigger}" already registered`);
	}
	registry.set(trigger, recognizer);
}

export function getInlineSyntax(trigger: string): InlineSyntaxRecognizer | undefined {
	return registry.get(trigger);
}

/** Empty-registry fast check that keeps the per-keystroke scan free of registry probes. */
export function hasInlineSyntax(): boolean {
	return registry.size > 0;
}

export function __resetInlineSyntaxForTests(): void {
	registry.clear();
}
