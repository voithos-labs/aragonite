/**
 * Unstable-public hook for plugin inline syntax. A recognizer owns a single
 * trigger character; the scanner consults the registry in its `default` arm
 * (scan/index.ts) only when a trigger is registered, so an empty registry
 * leaves inline parsing byte-identical to the built-in grammar.
 */

import type { InlineNode } from '../../nodes';
import { registerOnce } from '../../../schema/register-once';

/**
 * Inspect `raw` at `pos` (the trigger) within `[pos, end)`. Return a node whose
 * `start === pos` and `end > pos` to claim `[start, end)` — `end` is the scan
 * advance — or `null` to leave the trigger as literal text.
 */
export type InlineSyntaxRecognizer = (raw: string, pos: number, end: number) => InlineNode | null;

const registry = new Map<string, InlineSyntaxRecognizer>();

/**
 * The characters `scanInline`'s switch claims before reaching its `default` arm.
 * A recognizer registered on one of these would never be consulted — so reject it
 * here, the only place that can see the collision. Registration is the seam; a
 * silent no-op in a public API is the failure this exists to make impossible.
 * Keep in step with the switch in `./index.ts`.
 */
const BUILTIN_TRIGGERS = new Set(['\\', '`', '&', '\n', '*', '_', '~', '[', ']', '!', '<']);

export function registerInlineSyntax(trigger: string, recognizer: InlineSyntaxRecognizer): void {
	if (trigger.length !== 1) {
		throw new Error('registerInlineSyntax: trigger must be a single character');
	}
	if (BUILTIN_TRIGGERS.has(trigger)) {
		throw new Error(
			`registerInlineSyntax: ${JSON.stringify(trigger)} is claimed by the built-in scanner, ` +
				`which dispatches it before the plugin registry — the recognizer would never fire`
		);
	}
	registerOnce(
		registry.has(trigger),
		() => registry.set(trigger, recognizer),
		`registerInlineSyntax: "${trigger}" already registered`
	);
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
