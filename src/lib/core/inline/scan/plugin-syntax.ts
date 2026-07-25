/**
 * Unstable-public hook for plugin inline syntax, organized as a priority ladder
 * that mirrors the block layer's `OPENER_PRIORITIES`. A recognizer registers on a
 * single trigger character and, optionally, a multi-char prefix that begins with
 * it; the scanner dispatches rungs low-priority-first so a plugin can outrank a
 * built-in trigger on a longer prefix (footnotes' `[^` beating `[`) or coexist
 * with another plugin on one trigger deterministically.
 *
 * Two partitions, because the two dispatch paths differ by reserved-ness (a fixed
 * split, no overlap): reserved triggers (`BUILTIN_TRIGGERS`) hold prefix rungs the
 * scanner consults BEFORE its switch; every other trigger holds rungs the switch's
 * `default` arm consults. An empty registry leaves inline parsing byte-identical to
 * the built-in grammar. See `scan/index.ts` for the dispatch.
 */

import type { InlineNode } from '../../nodes';
import { registerOnce } from '../../../schema/register-once';

/**
 * Inspect `raw` at `pos` (the trigger) within `[pos, end)`. Return a node whose
 * `start === pos` and `end > pos` to claim `[start, end)` — `end` is the scan
 * advance — or `null` to leave the trigger as literal text.
 */
export type InlineSyntaxRecognizer = (raw: string, pos: number, end: number) => InlineNode | null;

/**
 * The priority ladder every registration prices against. Lower is consulted first,
 * mirroring `OPENER_PRIORITIES`.
 */
export const INLINE_PRIORITIES = {
	/** Rungs consulted before a reserved trigger's built-in handling. */
	prefixOverride: 40,
	/** The switch's own anchor. Not registerable; the boundary both rules price against. */
	builtin: 50,
	/** Default rung for bare-trigger registrations (the historical default-arm behavior). */
	plugin: 100
} as const;

export interface InlineSyntaxOptions {
	/**
	 * Multi-char prefix beginning with the trigger. Required to register a reserved
	 * trigger; the recognizer is consulted only when the prefix matches at the scan
	 * position.
	 */
	prefix?: string;
	/** Rung; lower is consulted first. Defaults to `INLINE_PRIORITIES.plugin`. */
	priority?: number;
}

export interface InlineRung {
	recognizer: InlineSyntaxRecognizer;
	/** The bare trigger for a bare registration; the multi-char prefix otherwise. */
	prefix: string;
	priority: number;
}

/**
 * The characters `scanInline`'s switch claims through `case` arms (`default` handles
 * the rest). A reserved trigger dispatches before the plugin registry, so a bare
 * registration on one would never fire — it must register a prefix rung priced below
 * `builtin` instead, which the scanner consults ahead of the switch. Keep in step
 * with the switch in `./index.ts` (pinned by G4.18).
 */
const BUILTIN_TRIGGERS = new Set(['\\', '`', '&', '\n', '*', '_', '~', '[', ']', '!', '<']);

/**
 * Reserved triggers `needsScan` (scan/index.ts) never visits in otherwise-plain
 * text: they sit outside `SPECIAL_CHARS` because they only matter inside `[`-bearing
 * ranges. A prefix rung on one would be accepted here yet never consulted — a silent
 * no-op, the failure this registration seam exists to make impossible — so it is
 * rejected. A future construct needing `!`/`]` must first make them scan-visible.
 * Pinned against a SPECIAL_CHARS edit by the inline-trigger-parity lint (G4.18).
 */
const SCAN_INVISIBLE_RESERVED = new Set(['!', ']']);

const NO_RUNGS: readonly InlineRung[] = [];

// Reserved-trigger prefix rungs (consulted pre-switch) live apart from every other
// trigger's rungs (consulted in the `default` arm) so each dispatch path reads one
// map and the empty-path gates stay a single `size` check.
const reservedRegistry = new Map<string, InlineRung[]>();
const unreservedRegistry = new Map<string, InlineRung[]>();

// ── Registration ───────────────────────────────────────────────────────────────

export function registerInlineSyntax(
	trigger: string,
	recognizer: InlineSyntaxRecognizer,
	options?: InlineSyntaxOptions
): void {
	if (trigger.length !== 1) {
		throw new Error('registerInlineSyntax: trigger must be a single character');
	}
	const { prefix, priority = INLINE_PRIORITIES.plugin } = options ?? {};
	if (prefix !== undefined && (prefix.length < 2 || !prefix.startsWith(trigger))) {
		throw new Error(
			`registerInlineSyntax: prefix ${JSON.stringify(prefix)} must begin with the trigger ` +
				`${JSON.stringify(trigger)} and be at least two characters`
		);
	}

	const reserved = BUILTIN_TRIGGERS.has(trigger);
	if (reserved) {
		// Bare-reserved throw is a pinned contract — keep the message verbatim.
		// A reserved trigger is reachable only through a
		// prefix rung priced below the switch anchor.
		if (prefix === undefined) {
			throw new Error(
				`registerInlineSyntax: ${JSON.stringify(trigger)} is claimed by the built-in scanner, ` +
					`which dispatches it before the plugin registry — the recognizer would never fire`
			);
		}
		if (SCAN_INVISIBLE_RESERVED.has(trigger)) {
			throw new Error(
				`registerInlineSyntax: reserved trigger ${JSON.stringify(trigger)} is skipped by the ` +
					`scanner's fast bail (absent from SPECIAL_CHARS in scan/index.ts; it matters only ` +
					`inside "["-bearing ranges), so a prefix rung on it would never fire in plain text — ` +
					`make the trigger scan-visible before registering`
			);
		}
		if (priority >= INLINE_PRIORITIES.builtin) {
			throw new Error(
				`registerInlineSyntax: reserved trigger ${JSON.stringify(trigger)} needs a priority ` +
					`below the built-in boundary (${INLINE_PRIORITIES.builtin}) so its prefix outranks ` +
					`the built-in scanner; got ${priority}`
			);
		}
	}

	const effectivePrefix = prefix ?? trigger;
	const registry = reserved ? reservedRegistry : unreservedRegistry;
	const existing = registry.get(trigger);
	const isDuplicate =
		existing?.some((r) => r.prefix === effectivePrefix && r.priority === priority) ?? false;
	registerOnce(
		isDuplicate,
		() => upsertRung(registry, trigger, { recognizer, prefix: effectivePrefix, priority }),
		`registerInlineSyntax: ${JSON.stringify(trigger)} already registered at prefix ` +
			`${JSON.stringify(effectivePrefix)}, priority ${priority}`
	);
}

// Kept sorted at insert so dispatch order is registration-order-independent:
// priority ascending, then prefix length descending, then prefix lexicographic.
function compareRungs(a: InlineRung, b: InlineRung): number {
	if (a.priority !== b.priority) return a.priority - b.priority;
	if (a.prefix.length !== b.prefix.length) return b.prefix.length - a.prefix.length;
	return a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0;
}

// Insert a fresh rung (re-sorting), or overwrite the recognizer of a matching
// (prefix, priority) rung — the dev-server replace path (register-once.ts).
function upsertRung(registry: Map<string, InlineRung[]>, trigger: string, rung: InlineRung): void {
	const rungs = registry.get(trigger);
	if (!rungs) {
		registry.set(trigger, [rung]);
		return;
	}
	const at = rungs.findIndex((r) => r.prefix === rung.prefix && r.priority === rung.priority);
	if (at >= 0) rungs[at] = rung;
	else {
		rungs.push(rung);
		rungs.sort(compareRungs);
	}
}

// ── Dispatch accessors ───────────────────────────────────────────────────────────

/** Rungs for a trigger in dispatch order, reserved-aware. Empty when none. */
export function getInlineRungs(trigger: string): readonly InlineRung[] {
	const registry = BUILTIN_TRIGGERS.has(trigger) ? reservedRegistry : unreservedRegistry;
	return registry.get(trigger) ?? NO_RUNGS;
}

/** The `default` arm's rungs for a char (undefined skips the arm's `tryRungs` call). */
export function getUnreservedRungs(char: string): InlineRung[] | undefined {
	return unreservedRegistry.get(char);
}

/** The pre-switch consultation's rungs for a reserved char. */
export function getPrefixRungs(char: string): InlineRung[] | undefined {
	return reservedRegistry.get(char);
}

/** Empty-registry fast check that keeps the per-keystroke scan free of registry probes. */
export function hasInlineSyntax(): boolean {
	return unreservedRegistry.size > 0;
}

/** Gate for the pre-switch consultation — false costs the scan loop nothing. */
export function hasPrefixRungs(): boolean {
	return reservedRegistry.size > 0;
}

export function __resetInlineSyntaxForTests(): void {
	reservedRegistry.clear();
	unreservedRegistry.clear();
}
