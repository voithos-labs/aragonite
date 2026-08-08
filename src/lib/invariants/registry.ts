import type { AnyBlockKind, AnyInlineKind, BlockKind } from '../core/nodes';
import type { InvariantViolation } from './assert';

/**
 * Registry predicates take every lookup as a parameter — pure by construction, and a
 * schema import here would cycle with the registration seam
 * (`schema/registration-checks.ts`) that supplies the real registries.
 */

/**
 * `listItem` renders inside its parent `ListBlock`, never via a `BlockHost` kind lookup,
 * so it is the one BlockKind with no component-registry entry by design.
 */
const NO_STANDALONE_COMPONENT: ReadonlySet<BlockKind> = new Set(['listItem']);

/**
 * G1.2 — every BlockKind resolves to a descriptor, and to a component unless it
 * renders inside a parent (see `NO_STANDALONE_COMPONENT`). Returns the first gap.
 */
export function checkRegistryCompleteness(
	kinds: readonly BlockKind[],
	hasDescriptor: (kind: BlockKind) => boolean,
	hasComponent: (kind: BlockKind) => boolean
): InvariantViolation | null {
	for (const kind of kinds) {
		if (!hasDescriptor(kind)) {
			return {
				code: 'registry-incomplete',
				message: `kind "${kind}" has no registered descriptor`,
				detail: { kind, missing: 'descriptor' }
			};
		}
		if (!NO_STANDALONE_COMPONENT.has(kind) && !hasComponent(kind)) {
			return {
				code: 'registry-incomplete',
				message: `kind "${kind}" has no registered component`,
				detail: { kind, missing: 'component' }
			};
		}
	}
	return null;
}

/**
 * G1.10 — opener-registry coherence: every registered opener belongs to a registered kind,
 * and priorities are unique. Equal priorities are deterministic (dispatch falls back to
 * kind name) but usually unintended, so they still warn.
 */
export function checkOpenerRegistry(
	entries: readonly { kind: AnyBlockKind; priority: number }[],
	hasDescriptor: (kind: AnyBlockKind) => boolean
): InvariantViolation | null {
	const seen = new Map<number, AnyBlockKind>();
	for (const { kind, priority } of entries) {
		if (!hasDescriptor(kind)) {
			return {
				code: 'opener-registry',
				message: `opener registered for "${kind}" but no descriptor exists`,
				detail: { kind, missing: 'descriptor' }
			};
		}
		const holder = seen.get(priority);
		if (holder !== undefined) {
			return {
				code: 'opener-registry',
				message: `kinds "${holder}" and "${kind}" share opener priority ${priority} — order falls back to kind name; give each kind its own priority`,
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

/**
 * G1.11 — keymap coherence: every binding uses a well-formed chord naming a known command,
 * and a kind's chords are unique after normalization. A mistyped `Ctrl+B` collapses to a
 * bare `B` that fires on every keypress; duplicates make dispatch order
 * declaration-dependent. Chords are scoped per kind.
 */
export function checkKeymapCoherence(
	entries: readonly KeymapCoherenceEntry[],
	isKnownCommand: (id: string) => boolean,
	normalizeChord: (chord: string) => string,
	isChordWellFormed: (chord: string) => boolean
): InvariantViolation | null {
	for (const { kind, keymap } of entries) {
		if (!keymap) continue;
		const seenChords = new Set<string>();
		for (const binding of keymap) {
			if (!isChordWellFormed(binding.chord)) {
				return {
					code: 'keymap-coherence',
					message: `kind "${kind}" binds malformed chord "${binding.chord}" — modifiers must be Mod/Alt/Shift and the key non-empty`,
					detail: { kind, chord: binding.chord, issue: 'malformed' }
				};
			}
			if (!isKnownCommand(binding.command)) {
				return {
					code: 'keymap-coherence',
					message: `kind "${kind}" binds chord "${binding.chord}" to unknown command "${binding.command}"`,
					detail: { kind, chord: binding.chord, command: binding.command }
				};
			}
			const chord = normalizeChord(binding.chord);
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

/**
 * G1.17 — opener registered after the grammar was consumed. Parsed documents never
 * re-parse, so the new kind silently misses every open document.
 */
export function checkLateOpenerRegistration(
	kind: AnyBlockKind,
	grammarConsumed: boolean
): InvariantViolation | null {
	if (!grammarConsumed) return null;
	return {
		code: 'late-opener-registration',
		message: `opener for "${kind}" registered after documents were parsed — already-parsed documents will not re-parse; register plugins before first mount`,
		detail: { kind }
	};
}

export interface ReservedChromeCoherenceEntry {
	kind: AnyBlockKind;
	isContainer: boolean;
	reservedChromeKind?: AnyBlockKind;
}

/**
 * G1.18 — reservedChrome bootstrap coherence: a declaring kind must be a container, and
 * its chrome kind must resolve to both a descriptor and a component. Validates the
 * registration shape at bootstrap, unlike the per-commit slot check (G1.14).
 */
export function checkReservedChromeCoherence(
	entries: readonly ReservedChromeCoherenceEntry[],
	hasDescriptor: (kind: AnyBlockKind) => boolean,
	hasComponent: (kind: AnyBlockKind) => boolean
): InvariantViolation | null {
	for (const { kind, isContainer, reservedChromeKind } of entries) {
		if (reservedChromeKind === undefined) continue;
		if (!isContainer) {
			return {
				code: 'reserved-chrome-coherence',
				message: `kind "${kind}" declares reservedChrome but is not a container`,
				detail: { kind, chromeKind: reservedChromeKind, issue: 'not-container' }
			};
		}
		if (!hasDescriptor(reservedChromeKind)) {
			return {
				code: 'reserved-chrome-coherence',
				message: `reservedChrome kind "${reservedChromeKind}" (declared by "${kind}") has no registered descriptor`,
				detail: { kind, chromeKind: reservedChromeKind, missing: 'descriptor' }
			};
		}
		if (!hasComponent(reservedChromeKind)) {
			return {
				code: 'reserved-chrome-coherence',
				message: `reservedChrome kind "${reservedChromeKind}" (declared by "${kind}") has no registered component`,
				detail: { kind, chromeKind: reservedChromeKind, missing: 'component' }
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
	declaresReservedChrome: boolean;
	clipboardMode: ClosureCellMode;
}

/**
 * Fixed phrases rather than a loose pattern: the claim is what a plugin author copies out
 * of the shipped descriptors, and "moves focus" (what an ordinary not-mergeable leaf does
 * at its edge) must stay outside the set.
 */
const FOCUS_THEN_DELETE_CLAIMS = ['focus-then-delete', 'a second press deletes'] as const;

const claimsFocusThenDelete = (via: string | undefined): boolean =>
	via !== undefined && FOCUS_THEN_DELETE_CLAIMS.some((phrase) => via.includes(phrase));

/**
 * G1.24 — closure-block coherence: cross-checks between a kind's closure cells and the
 * rest of its descriptor that a compiler can't reach. Each violation message below states
 * its own rule. The fixture-parses-to-kind check runs in the unit sweep instead — a
 * `parse` import here would close a `schema → core/parser → schema` cycle.
 */
export function checkClosureCoherence(
	entries: readonly ClosureCoherenceEntry[]
): InvariantViolation | null {
	for (const entry of entries) {
		if (entry.hasContainerContract && entry.roundTripMode === 'inherit-default') {
			return {
				code: 'closure-coherence',
				message: `kind "${entry.kind}" declares a container contract but its closure roundTrip is inherit-default — the container's rebuildRaw is the round-trip mechanism; declare roundTrip: implemented`,
				detail: { kind: entry.kind, column: 'roundTrip' }
			};
		}
		if (entry.notMergeable && entry.mergeBackspaceMode === 'inherit-default') {
			return {
				code: 'closure-coherence',
				message: `kind "${entry.kind}" is not-mergeable but its closure mergeBackspace is inherit-default — a not-mergeable kind has no default merge to inherit; name the non-merge mechanism (implemented) or mark it not-supported`,
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
					message: `kind "${entry.kind}" claims the focus-then-delete model in its closure ${column} cell but declares no blockFocus: 'whole-block' — without it the caret-adjacent merge fallback deletes on the first press; declare the field or rewrite the cell to say what the kind actually does`,
					detail: { kind: entry.kind, column }
				};
			}
		}
		if (entry.declaresReservedChrome && entry.clipboardMode === 'inherit-default') {
			return {
				code: 'closure-coherence',
				message: `kind "${entry.kind}" declares reservedChrome but its closure clipboard is inherit-default — the chrome bytes live in the container's own opener line, so a slice crossing that boundary has no default semantics; name what a copy produces (implemented) or mark it not-supported`,
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
	splitBehavior: 'close-and-reopen' | 'plain';
}

/**
 * G1.31 — inline-construct policy coherence: a row names a kind the inline vocabulary holds,
 * and the marker-rewriting behaviors belong only to kinds whose markers the reveal can address.
 * A row for a mistyped kind is silent — the construct keeps the absent-row defaults — and a
 * rewrite on a never-revealed kind edits markers the author has no way to see.
 */
export function checkInlineConstructPolicy(
	entries: readonly InlineConstructPolicyEntry[],
	isKnownInlineKind: (kind: AnyInlineKind) => boolean
): InvariantViolation | null {
	for (const entry of entries) {
		if (!isKnownInlineKind(entry.kind)) {
			return {
				code: 'inline-construct-policy',
				message: `inline-construct policy registered for "${entry.kind}", which is neither a built-in inline kind nor a declared plugin one — the row is unreachable`,
				detail: { kind: entry.kind, issue: 'unknown-kind' }
			};
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
				message: `kind "${entry.kind}" is not revealable but its ${column} rewrites markers — a never-revealed construct's markers stay hidden, so the rewrite is invisible; mark the kind revealable or make the behavior atomic`,
				detail: { kind: entry.kind, column }
			};
		}
	}
	return null;
}

export interface MergeRoleEntry {
	kind: AnyBlockKind;
	mergeRole: string;
}

/**
 * G1.30 — every registered kind declares a `mergeRole` from the known vocabulary. A
 * per-KIND fact, validated once at registration: an unknown role makes the merge
 * dispatcher fall through silently on every gesture that reaches the kind.
 */
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
