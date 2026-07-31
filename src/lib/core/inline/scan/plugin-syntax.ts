/**
 * Unstable-public hook for plugin inline syntax: a priority ladder mirroring `OPENER_PRIORITIES`.
 * One trigger character plus an optional prefix beginning with it, dispatched low-priority-first
 * so a plugin can outrank a built-in trigger on a longer prefix (footnotes' `[^` beating `[`).
 * Reserved triggers hold pre-switch rungs, all others hold `default`-arm rungs (scan/index.ts).
 */

import type { ImageSyntaxRewriter, InlineNode, InlineSyntaxClaim } from '../../nodes';
import { registerOnce } from '../../../schema/register-once';

/**
 * Inspect `raw` at `pos` (the trigger) within `[pos, end)`. Return a node with `start === pos`
 * and `pos < node.end <= end` to claim that span (`node.end` is the scan advance), or `null` to
 * leave the trigger literal. `end` bounds the search too: `raw` is the whole block while the
 * range may be a slice of it, so a terminator past `end` must decline. Claiming past it throws.
 */
export type InlineSyntaxRecognizer = (raw: string, pos: number, end: number) => InlineNode | null;

/** The priority ladder every registration prices against; lower is consulted first. */
export const INLINE_PRIORITIES = {
	/** Rungs consulted before a reserved trigger's built-in handling. */
	prefixOverride: 40,
	/** The switch's own anchor; not registerable. */
	builtin: 50,
	/** Default rung for bare-trigger registrations. */
	plugin: 100
} as const;

export interface InlineSyntaxOptions {
	/**
	 * Multi-char prefix beginning with the trigger; required for a reserved trigger. Consulted
	 * ahead of the built-in case, so a prefix that also opens a built-in construct outranks it
	 * and the recognizer must decline the overlap itself. Getting that wrong is silent; see the
	 * plugin guide's reserved-trigger section.
	 */
	prefix?: string;
	/** Rung; lower is consulted first. Defaults to `INLINE_PRIORITIES.plugin`. */
	priority?: number;
	/**
	 * Re-serializer for the built-in `image` nodes this recognizer mints; without it the editor
	 * declines those edits rather than writing GFM over the claimed bytes. Return `null` for
	 * anything your grammar cannot hold: source-identical bytes are dropped silently by the
	 * commit's equality guard. See the plugin guide's inline section.
	 */
	rewriteImage?: ImageSyntaxRewriter;
}

export interface InlineRung extends InlineSyntaxClaim {
	recognizer: InlineSyntaxRecognizer;
	priority: number;
}

/**
 * The characters `scanInline`'s switch claims. A bare registration on one would never fire; it
 * needs a prefix rung priced below `builtin`. Kept in step with `./index.ts` by G4.18.
 */
const BUILTIN_TRIGGERS = new Set(['\\', '`', '&', '\n', '*', '_', '~', '[', ']', '!', '<']);

/**
 * Reserved triggers a registration makes visible to `needsScan` (scan/index.ts) instead, probed
 * only while a rung lives on them. `!` is here rather than in `SPECIAL_CHARS` because making it
 * unconditionally special would drag every prose `"Hello!"` through the full scan loop.
 */
const SCAN_PROBED_RESERVED = new Set(['!']);

/**
 * Reserved triggers with no route to the scan at all, so a prefix rung on one would be accepted
 * yet never consulted: the silent no-op this seam exists to prevent. A construct needing `]`
 * gives it a route first. Pinned against a SPECIAL_CHARS edit by G4.18.
 */
const REJECTED_RESERVED = new Set([']']);

const NO_RUNGS: readonly InlineRung[] = [];

// Reserved-trigger prefix rungs (pre-switch) live apart from every other trigger's rungs
// (`default` arm) so each dispatch path reads one map and its empty gate is one `size` check.
const reservedRegistry = new Map<string, InlineRung[]>();
const unreservedRegistry = new Map<string, InlineRung[]>();

// Triggers the fast bail (`needsScan`, scan/index.ts) must visit while a rung lives on them.
// Maintained at registration, so a rung on a trigger `SPECIAL_CHARS` already visits costs nothing.
const scanProbeTriggers = new Set<string>();

// ── Registration ───────────────────────────────────────────────────────────────

export function registerInlineSyntax(
	trigger: string,
	recognizer: InlineSyntaxRecognizer,
	options?: InlineSyntaxOptions
): void {
	if (trigger.length !== 1) {
		throw new Error('registerInlineSyntax: trigger must be a single character');
	}
	const { prefix, priority = INLINE_PRIORITIES.plugin, rewriteImage } = options ?? {};
	if (prefix !== undefined && (prefix.length < 2 || !prefix.startsWith(trigger))) {
		throw new Error(
			`registerInlineSyntax: prefix ${JSON.stringify(prefix)} must begin with the trigger ` +
				`${JSON.stringify(trigger)} and be at least two characters`
		);
	}

	const reserved = BUILTIN_TRIGGERS.has(trigger);
	if (reserved) {
		// Pinned contract: keep the message verbatim. A reserved trigger is reachable only
		// through a prefix rung priced below the switch anchor.
		if (prefix === undefined) {
			throw new Error(
				`registerInlineSyntax: ${JSON.stringify(trigger)} is claimed by the built-in scanner, ` +
					`which dispatches it before the plugin registry — the recognizer would never fire`
			);
		}
		if (REJECTED_RESERVED.has(trigger)) {
			throw new Error(
				`registerInlineSyntax: reserved trigger ${JSON.stringify(trigger)} is skipped by the ` +
					`scanner's fast bail (absent from SPECIAL_CHARS in scan/index.ts; it matters only ` +
					`inside "["-bearing ranges), so a prefix rung on it would never fire in plain text — ` +
					`make the trigger scan-visible or scan-probed before registering`
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
		() => {
			upsertRung(registry, trigger, {
				recognizer,
				prefix: effectivePrefix,
				priority,
				rewriteImage
			});
			// A rung on a trigger the fast bail would skip must make the scan visit it,
			// or the recognizer is the silent no-op this seam refuses to accept.
			if (!reserved || SCAN_PROBED_RESERVED.has(trigger)) scanProbeTriggers.add(trigger);
		},
		`registerInlineSyntax: ${JSON.stringify(trigger)} already registered at prefix ` +
			`${JSON.stringify(effectivePrefix)}, priority ${priority}`
	);
}

// Kept sorted at insert so dispatch order does not depend on registration order.
function compareRungs(a: InlineRung, b: InlineRung): number {
	if (a.priority !== b.priority) return a.priority - b.priority;
	if (a.prefix.length !== b.prefix.length) return b.prefix.length - a.prefix.length;
	return a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0;
}

// Overwriting a matching (prefix, priority) rung is the dev-server replace path.
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

/**
 * Whether the built-in scanner claims `trigger` through a `case` arm. A rung on one is consulted
 * BEFORE that arm, so it owes the overlap a decline; the conformance kit refuses it an exemption.
 */
export function isReservedInlineTrigger(trigger: string): boolean {
	return BUILTIN_TRIGGERS.has(trigger);
}

/** Rungs for a trigger in dispatch order, reserved-aware. Empty when none. */
export function getInlineRungs(trigger: string): readonly InlineRung[] {
	const registry = BUILTIN_TRIGGERS.has(trigger) ? reservedRegistry : unreservedRegistry;
	return registry.get(trigger) ?? NO_RUNGS;
}

export function getUnreservedRungs(char: string): InlineRung[] | undefined {
	return unreservedRegistry.get(char);
}

export function getPrefixRungs(char: string): InlineRung[] | undefined {
	return reservedRegistry.get(char);
}

export function hasInlineSyntax(): boolean {
	return unreservedRegistry.size > 0;
}

/** Read once per scan, so an empty set leaves `needsScan` at its pre-plugin cost. */
export function hasScanProbeRungs(): boolean {
	return scanProbeTriggers.size > 0;
}

export function isScanProbeTrigger(char: string): boolean {
	return scanProbeTriggers.has(char);
}

/** False costs the scan loop nothing. */
export function hasPrefixRungs(): boolean {
	return reservedRegistry.size > 0;
}

export function __resetInlineSyntaxForTests(): void {
	reservedRegistry.clear();
	unreservedRegistry.clear();
	scanProbeTriggers.clear();
}
