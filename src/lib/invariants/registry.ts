import type { AnyBlockKind, BlockKind } from '../core/nodes';
import type { InvariantViolation } from './assert';

/**
 * Registry predicates take every lookup as a parameter — pure by construction.
 * The registries they validate call back into this module at the registration
 * seam (`schema/registration-checks.ts`), so a schema import here would cycle;
 * that seam supplies the real registries, and negative tests inject their own.
 */

/**
 * `listItem` is the one BlockKind with no component-registry entry by design:
 * items render inside their parent `ListBlock`, never via a `BlockHost` kind
 * lookup, so `getBlockComponent('listItem')` is intentionally undefined (the
 * `BlockHost` visible-raw fallback covers any stray lookup). `tableRow`/`tableCell`
 * are registered (raw-block fallbacks), so `listItem` is the sole exemption —
 * exempting it keeps the bootstrap invariant channel free of a benign warning.
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
 * G1.10 — opener-registry coherence: every registered opener belongs to a
 * registered kind, and priorities are unique (equal priorities are deterministic
 * — dispatch falls back to kind name — but a shared priority is usually
 * unintended, so it still warns).
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
 * G1.11 — keymap coherence: every keymap binding names a known command, and a
 * kind's chords are unique after normalization (duplicates make dispatch order
 * declaration-dependent). Chords are scoped per kind — two kinds may bind the
 * same chord to different commands. Reports the first offending binding.
 */
export function checkKeymapCoherence(
	entries: readonly KeymapCoherenceEntry[],
	isKnownCommand: (id: string) => boolean,
	normalizeChord: (chord: string) => string
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
 * G1.17 — opener registered after the grammar was consumed. Parsed documents
 * never re-parse, so the new kind silently misses every open document; the
 * registration seam records the lateness and the next flush reports it.
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
 * G1.18 — reservedChrome bootstrap coherence: a kind declaring `reservedChrome`
 * must be a container, and its chrome kind must resolve to both a descriptor and
 * a component (both registered by `registerChromeLeaf`). Catches a declarer that
 * put chrome on a leaf, or one whose chrome leaf was never registered. Distinct
 * from the per-commit slot check (G1.14): this validates the registration shape
 * at bootstrap, not a live tree. Reports the first offending declarer.
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
}

/**
 * G1.24 — closure-block coherence: the two cross-checks between a kind's closure
 * cells and the rest of its descriptor that a compiler can't reach. (a) A
 * container (declares `container.contract`) cannot claim `roundTrip:
 * inherit-default` — its `rebuildRaw` IS the round-trip mechanism, so the cell
 * must name it. (b) A `not-mergeable` kind cannot claim `mergeBackspace:
 * inherit-default` — the default merge does not apply to it, so the cell must
 * name the non-merge behavior (`implemented`) or mark it `not-supported`. The
 * fixture-parses-to-kind check (rule c) runs in the unit sweep, not here: a
 * `parse` import would close a `schema → core/parser → schema` cycle. Reports
 * the first offending kind.
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
	}
	return null;
}
