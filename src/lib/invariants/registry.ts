import type { AnyBlockKind, AnyInlineKind, BlockKind } from '../core/nodes';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import type { SplitBehavior } from '../schema/inline-construct-policy';

/**
 * The registry checks take every lookup as a parameter, so they stay pure and so this file never
 * imports `schema`: `schema/registration-checks.ts` supplies the real registries, and importing
 * it back would close a cycle.
 */

/** G1.2: every BlockKind resolves to a descriptor. Returns the first gap. */
export function checkRegistryCompleteness(
	kinds: readonly BlockKind[],
	hasDescriptor: (kind: BlockKind) => boolean
): InvariantViolation | null {
	for (const kind of kinds) {
		if (!hasDescriptor(kind)) {
			return {
				code: 'registry-incomplete',
				message: `kind "${kind}" has no registered descriptor`,
				detail: { kind, missing: 'descriptor' }
			};
		}
	}
	return null;
}

/** G1.10: no two openers share a priority. A tie still dispatches by kind name but is almost
 *  always a mistake, so it warns. */
export function checkOpenerRegistry(
	entries: readonly { kind: AnyBlockKind; priority: number }[]
): InvariantViolation | null {
	const seen = new Map<number, AnyBlockKind>();
	for (const { kind, priority } of entries) {
		const holder = seen.get(priority);
		if (holder !== undefined) {
			return {
				code: 'opener-registry',
				message: `kinds "${holder}" and "${kind}" share opener priority ${priority}: order falls back to kind name; give each kind its own priority`,
				detail: { kinds: [holder, kind], priority }
			};
		}
		seen.set(priority, kind);
	}
	return null;
}

export interface KeymapCoherenceEntry {
	kind: AnyBlockKind;
	keymap?: readonly { chord: string; command: string }[];
}

/** G1.11: every binding names a known command, and a kind binds each chord once. Checked at the flush,
 *  not at registration, since a plugin can register its kind before the command. */
export function checkKeymapCoherence(
	entries: readonly KeymapCoherenceEntry[],
	isKnownCommand: (id: string) => boolean
): InvariantViolation | null {
	for (const { kind, keymap } of entries) {
		if (!keymap) continue;
		const seenChords = new Set<string>();
		for (const binding of keymap) {
			if (!isKnownCommand(binding.command)) {
				return {
					code: 'keymap-coherence',
					message: `kind "${kind}" binds chord "${binding.chord}" to unknown command "${binding.command}"`,
					detail: { kind, chord: binding.chord, command: binding.command }
				};
			}
			const chord = binding.chord;
			if (seenChords.has(chord)) {
				return {
					code: 'keymap-coherence',
					message: `kind "${kind}" binds chord "${chord}" more than once`,
					detail: { kind, chord }
				};
			}
			seenChords.add(chord);
		}
	}
	return null;
}

/** G1.17: an opener registered after the grammar was read. Parsed documents never reparse, so the
 *  new kind misses every document already open. */
export function checkLateOpenerRegistration(
	kind: AnyBlockKind,
	grammarConsumed: boolean
): InvariantViolation | null {
	if (!grammarConsumed) return null;
	return {
		code: 'late-opener-registration',
		message: `opener for "${kind}" registered after documents were parsed: already-parsed documents will not re-parse; register plugins before first mount`,
		detail: { kind }
	};
}

export interface ReservedChromeCoherenceEntry {
	kind: AnyBlockKind;
	/** The row kind the container's `reservedChrome` declares. */
	reservedChromeKind?: AnyBlockKind;
	/** The row kind its child 0 holds: the declared one, or a `:::` container's opener line. */
	rowKind?: AnyBlockKind;
}

/** G1.18: the title-row kind a container's `reservedChrome` names is registered, which brings its
 *  view with it, and is the row its child 0 holds. G1.14 checks the child itself on every commit. */
export function checkReservedChromeCoherence(
	entries: readonly ReservedChromeCoherenceEntry[],
	hasDescriptor: (kind: AnyBlockKind) => boolean
): InvariantViolation | null {
	for (const { kind, reservedChromeKind, rowKind } of entries) {
		if (reservedChromeKind === undefined) continue;
		if (!hasDescriptor(reservedChromeKind)) {
			return {
				code: 'reserved-chrome-coherence',
				message: `reservedChrome kind "${reservedChromeKind}" (declared by "${kind}") has no registered descriptor`,
				detail: { kind, chromeKind: reservedChromeKind, missing: 'descriptor' }
			};
		}
		if (rowKind !== undefined && rowKind !== reservedChromeKind) {
			return {
				code: 'reserved-chrome-coherence',
				message: `reservedChrome kind "${reservedChromeKind}" (declared by "${kind}") is never built: a \`:::\` container's title row is its opener line, so declare kind "${rowKind}" there`,
				detail: { kind, chromeKind: reservedChromeKind, built: rowKind }
			};
		}
	}
	return null;
}

type ClosureCellMode = 'implemented' | 'inherit-default' | 'not-supported';

export interface ClosureCoherenceEntry {
	kind: AnyBlockKind;
	notMergeable: boolean;
	hasContainerContract: boolean;
	roundTripMode: ClosureCellMode;
	mergeBackspaceMode: ClosureCellMode;
	/** The descriptor declares `blockFocus: 'whole-block'`. */
	declaresWholeBlockFocus: boolean;
	/** `via` prose of an `implemented` cell; undefined for the other two modes. */
	focusVia: string | undefined;
	mergeBackspaceVia: string | undefined;
	/** Child 0 is a title row: a declared `reservedChrome`, or a `:::` container's opener line. */
	hasTitleRow: boolean;
	clipboardMode: ClosureCellMode;
}

/** Fixed phrases, not a pattern: plugin authors copy them from the shipped descriptors, and
 *  "moves focus" (an ordinary leaf's edge) must stay outside the set. */
const FOCUS_THEN_DELETE_CLAIMS = ['focus-then-delete', 'a second press deletes'] as const;

const claimsFocusThenDelete = (via: string | undefined): boolean =>
	via !== undefined && FOCUS_THEN_DELETE_CLAIMS.some((phrase) => via.includes(phrase));

/** G1.24: cross-checks between a kind's closure cells and the rest of its descriptor that the
 *  compiler cannot reach. The fixture-parse check is in the unit suite, which avoids a cycle. */
export function checkClosureCoherence(
	entries: readonly ClosureCoherenceEntry[]
): InvariantViolation | null {
	for (const entry of entries) {
		if (entry.hasContainerContract && entry.roundTripMode === 'inherit-default') {
			return {
				code: 'closure-coherence',
				message: `kind "${entry.kind}" declares a container contract but its closure roundTrip is inherit-default: the container's rebuildRaw is the round-trip mechanism; declare roundTrip: implemented`,
				detail: { kind: entry.kind, column: 'roundTrip' }
			};
		}
		if (entry.notMergeable && entry.mergeBackspaceMode === 'inherit-default') {
			return {
				code: 'closure-coherence',
				message: `kind "${entry.kind}" is not-mergeable but its closure mergeBackspace is inherit-default: a not-mergeable kind has no default merge to inherit; name the non-merge mechanism (implemented) or mark it not-supported`,
				detail: { kind: entry.kind, column: 'mergeBackspace' }
			};
		}
		if (!entry.declaresWholeBlockFocus) {
			const column = claimsFocusThenDelete(entry.focusVia)
				? 'focus'
				: claimsFocusThenDelete(entry.mergeBackspaceVia)
					? 'mergeBackspace'
					: undefined;
			if (column !== undefined) {
				return {
					code: 'closure-coherence',
					message: `kind "${entry.kind}" claims the focus-then-delete model in its closure ${column} cell but declares no blockFocus: 'whole-block'; without it the caret-adjacent merge fallback deletes on the first press; declare the field or rewrite the cell to say what the kind actually does`,
					detail: { kind: entry.kind, column }
				};
			}
		}
		if (entry.hasTitleRow && entry.clipboardMode === 'inherit-default') {
			return {
				code: 'closure-coherence',
				message: `kind "${entry.kind}" has a title row but its closure clipboard is inherit-default: the row's bytes live in the container's own opener line, so a slice crossing that boundary has no default semantics; name what a copy produces (implemented) or mark it not-supported`,
				detail: { kind: entry.kind, column: 'clipboard' }
			};
		}
	}
	return null;
}

export interface InlineConstructPolicyEntry {
	kind: AnyInlineKind;
	revealable: boolean;
	autoUnwrapOnEmpty: boolean;
	splitBehavior: SplitBehavior;
	/** The mark vocabulary, for a kind a format chord addresses. */
	mark?: { nestingRank: number; command: string };
}

/** G1.31: each inline-policy row names a real kind, gives marker rewrites only to kinds that show
 *  their markers, and holds a unique nesting rank and command, never a built-in one. */
export function checkInlineConstructPolicy(
	entries: readonly InlineConstructPolicyEntry[],
	isKnownInlineKind: (kind: AnyInlineKind) => boolean,
	isBuiltinInlineKind: (kind: AnyInlineKind) => boolean,
	isBuiltinCommandId: (id: string) => boolean
): InvariantViolation | null {
	const ranks = new Map<number, AnyInlineKind>();
	const commands = new Map<string, AnyInlineKind>();
	for (const entry of entries) {
		if (!isKnownInlineKind(entry.kind)) {
			return {
				code: 'inline-construct-policy',
				message: `inline-construct policy registered for "${entry.kind}", which is neither a built-in inline kind nor a declared plugin one: the row is unreachable`,
				detail: { kind: entry.kind, issue: 'unknown-kind' }
			};
		}
		if (entry.mark) {
			const clash = markClashOf(entry.kind, entry.mark, ranks, commands);
			if (clash) return clash;
			// A built-in command id already means something, so a plugin mark taking one would shadow
			// that meaning wherever the mark table is consulted first.
			if (!isBuiltinInlineKind(entry.kind) && isBuiltinCommandId(entry.mark.command)) {
				return {
					code: 'inline-construct-policy',
					message: `kind "${entry.kind}" claims built-in command "${entry.mark.command}" for its mark: that id already has a built-in meaning; create a plugin command id for the mark`,
					detail: { kind: entry.kind, command: entry.mark.command, issue: 'builtin-command' }
				};
			}
		}
		if (entry.revealable) continue;
		const column =
			entry.splitBehavior === 'close-and-reopen'
				? 'splitBehavior'
				: entry.autoUnwrapOnEmpty
					? 'autoUnwrapOnEmpty'
					: undefined;
		if (column !== undefined) {
			return {
				code: 'inline-construct-policy',
				message: `kind "${entry.kind}" is not revealable but its ${column} rewrites markers: a never-revealed construct's markers stay hidden, so the rewrite is invisible; mark the kind revealable or make the behavior atomic`,
				detail: { kind: entry.kind, column }
			};
		}
	}
	return null;
}

function markClashOf(
	kind: AnyInlineKind,
	mark: { nestingRank: number; command: string },
	ranks: Map<number, AnyInlineKind>,
	commands: Map<string, AnyInlineKind>
): InvariantViolation | null {
	const rankHolder = ranks.get(mark.nestingRank);
	if (rankHolder !== undefined) {
		return {
			code: 'inline-construct-policy',
			message: `kinds "${rankHolder}" and "${kind}" share mark nesting rank ${mark.nestingRank}: which one wraps the other would fall to registration order`,
			detail: { kinds: [rankHolder, kind], nestingRank: mark.nestingRank }
		};
	}
	const commandHolder = commands.get(mark.command);
	if (commandHolder !== undefined) {
		return {
			code: 'inline-construct-policy',
			message: `kinds "${commandHolder}" and "${kind}" both claim command "${mark.command}": one press cannot toggle two marks`,
			detail: { kinds: [commandHolder, kind], command: mark.command }
		};
	}
	ranks.set(mark.nestingRank, kind);
	commands.set(mark.command, kind);
	return null;
}

export interface MergeRoleEntry {
	kind: AnyBlockKind;
	mergeRole: string;
}

/** G1.30: every kind declares a known `mergeRole`, checked once at registration, since an unknown
 *  role makes the merge dispatcher fall through silently. */
export function checkMergeRoleVocabulary(
	entries: readonly MergeRoleEntry[],
	isKnownMergeRole: (role: string) => boolean
): InvariantViolation | null {
	for (const { kind, mergeRole } of entries) {
		if (!isKnownMergeRole(mergeRole)) {
			return {
				code: 'merge-role-vocabulary',
				message: `kind "${kind}" declares unknown mergeRole "${mergeRole}"`,
				detail: { kind, mergeRole }
			};
		}
	}
	return null;
}

export interface PresentationFactEntry {
	kind: AnyBlockKind;
	declaresPageRole: boolean;
	declaresEstimateHeight: boolean;
}

/** G1.40: every built-in kind declares how it reads on the page and its likely height; a built-in
 *  left on the defaults would take a plugin's guesses unnoticed. */
export function checkBuiltinPresentationFacts(
	entries: readonly PresentationFactEntry[]
): InvariantViolation | null {
	for (const { kind, declaresPageRole, declaresEstimateHeight } of entries) {
		const missing = !declaresPageRole
			? 'pageRole'
			: !declaresEstimateHeight
				? 'estimateHeight'
				: null;
		if (missing === null) continue;
		return {
			code: 'builtin-presentation-facts',
			message: `built-in kind "${kind}" declares no ${missing}; declare it in built-in-descriptors.ts`,
			detail: { kind, missing }
		};
	}
	return null;
}
