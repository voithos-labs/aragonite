/**
 * Registry for plugin inline syntax: one trigger character plus an optional prefix beginning with
 * it, tried lowest priority first (the same numbering as `OPENER_PRIORITIES`), so a plugin can
 * outrank a built-in trigger with a longer prefix (footnotes' `[^` beating `[`). An `InlineRung`
 * is one registered handler. Handlers on a reserved trigger are consulted before the scanner's
 * switch, all others from its `default` branch (scan/index.ts).
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

/** The priority numbers registrations use; lower is consulted first. */
export const INLINE_PRIORITIES = {
	/** Handlers consulted before a reserved trigger's built-in handling. */
	prefixOverride: 40,
	/** The switch's own anchor; not registerable. */
	builtin: 50,
	/** Default for bare-trigger registrations. */
	plugin: 100
} as const;

export interface InlineSyntaxOptions {
	/**
	 * Multi-character prefix beginning with the trigger; required for a reserved trigger. It is
	 * consulted ahead of the built-in handler, so a prefix that also opens a built-in construct
	 * outranks it, and the recognizer must decline that overlap itself (the plugin guide's
	 * reserved-trigger section).
	 */
	prefix?: string;
	/** Lower is consulted first. Defaults to `INLINE_PRIORITIES.plugin`. */
	priority?: number;
	/**
	 * Re-serializer for the built-in `image` nodes this recognizer creates; without it the editor
	 * declines those edits rather than writing GFM over the claimed bytes. Return `null` for
	 * anything your grammar cannot hold (the plugin guide's inline section).
	 */
	rewriteImage?: ImageSyntaxRewriter;
	/**
	 * The trigger is a symmetric one-byte delimiter (`$…$`) that typing should close at once: the
	 * matching closer lands after the caret, so the new opener pairs with it rather than with a
	 * later formula's delimiter (`delimiter-autopair.ts`). Bare triggers only.
	 */
	autoPair?: boolean;
}

export interface InlineRung extends InlineSyntaxClaim {
	recognizer: InlineSyntaxRecognizer;
	priority: number;
}

/**
 * The characters `scanInline`'s switch handles itself. A bare registration on one would never
 * fire; it needs a prefix and a priority below `builtin`. A lint test keeps this set in step with
 * `./index.ts` (G4.18).
 */
const BUILTIN_TRIGGERS = new Set(['\\', '`', '&', '\n', '*', '_', '~', '[', ']', '!', '<']);

/**
 * Reserved triggers the fast bail (`needsScan`, scan/index.ts) checks only while a handler is
 * registered on them. `!` is here rather than in `SPECIAL_CHARS` because making it always
 * special would drag every prose `"Hello!"` through the full scan loop.
 */
const SCAN_PROBED_RESERVED = new Set(['!']);

/**
 * Reserved triggers the scan never reaches, so a prefix registration on one would be accepted yet
 * never consulted: the silent no-op this registry exists to refuse. A construct needing `]` gives
 * it a route first. A lint test pins this against a `SPECIAL_CHARS` edit (G4.18).
 */
const REJECTED_RESERVED = new Set([']']);

const NO_RUNGS: readonly InlineRung[] = [];

// Reserved-trigger handlers (consulted before the switch) live apart from all other handlers
// (consulted from its `default` branch) so each dispatch path reads one map and its empty check
// is one `size` read.
const reservedRegistry = new Map<string, InlineRung[]>();
const unreservedRegistry = new Map<string, InlineRung[]>();

// Triggers that close themselves as they are typed (`autoPair`); the built-in backtick is not
// here, the typing path knows it on its own.
const autoPairTriggers = new Set<string>();

// Triggers the fast bail (`needsScan`, scan/index.ts) must check while a handler is registered
// on them. Filled at registration, so a handler on a trigger `SPECIAL_CHARS` already checks
// costs nothing.
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
	const { prefix, priority = INLINE_PRIORITIES.plugin, rewriteImage, autoPair } = options ?? {};
	if (prefix !== undefined && (prefix.length < 2 || !prefix.startsWith(trigger))) {
		throw new Error(
			`registerInlineSyntax: prefix ${JSON.stringify(prefix)} must begin with the trigger ` +
				`${JSON.stringify(trigger)} and be at least two characters`
		);
	}

	const reserved = BUILTIN_TRIGGERS.has(trigger);
	if (reserved) {
		// A test pins this message verbatim. A reserved trigger is reachable only through a
		// prefix with a priority below `builtin`.
		if (prefix === undefined) {
			throw new Error(
				`registerInlineSyntax: ${JSON.stringify(trigger)} is claimed by the built-in scanner, ` +
					`which dispatches it before the plugin registry; the recognizer would never fire`
			);
		}
		if (REJECTED_RESERVED.has(trigger)) {
			throw new Error(
				`registerInlineSyntax: reserved trigger ${JSON.stringify(trigger)} is skipped by the ` +
					`scanner's fast bail (absent from SPECIAL_CHARS in scan/index.ts; it matters only ` +
					`inside "["-bearing ranges), so a prefix inline syntax handler on it would never fire in plain text; ` +
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

	if (autoPair && prefix !== undefined) {
		throw new Error(
			`registerInlineSyntax: autoPair pairs the bare trigger ${JSON.stringify(trigger)} with ` +
				`itself, so it cannot be combined with a prefix`
		);
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
			// A handler on a trigger the fast bail would skip must make the scan check it,
			// or the recognizer is the silent no-op this registry refuses to accept.
			if (!reserved || SCAN_PROBED_RESERVED.has(trigger)) scanProbeTriggers.add(trigger);
			if (autoPair) autoPairTriggers.add(trigger);
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

// Overwriting a handler with the same prefix and priority is the dev-server hot-reload path.
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
 * Whether the built-in scanner handles `trigger` in its switch. A plugin handler on one is
 * consulted before the switch, so it must decline the overlap itself; the conformance kit grants
 * no exemption.
 */
export function isReservedInlineTrigger(trigger: string): boolean {
	return BUILTIN_TRIGGERS.has(trigger);
}

/** The handlers for a trigger in dispatch order, from whichever map holds it. Empty when none. */
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

/** Whether a plugin asked for `char` to close itself as it is typed. */
export function isAutoPairTrigger(char: string): boolean {
	return autoPairTriggers.has(char);
}

/** False costs the scan loop nothing. */
export function hasPrefixRungs(): boolean {
	return reservedRegistry.size > 0;
}

export function __resetInlineSyntaxForTests(): void {
	reservedRegistry.clear();
	unreservedRegistry.clear();
	scanProbeTriggers.clear();
	autoPairTriggers.clear();
}
