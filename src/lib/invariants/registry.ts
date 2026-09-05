import type { AnyBlockKind, AnyInlineKind, BlockKind } from '../core/nodes';
import type { InvariantViolation } from '../assert';

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
	/** The mark vocabulary, for a kind a format chord addresses. */
	mark?: { nestingRank: number; command: string };
}

/**
 * G1.31 — inline-construct policy coherence: a row names a kind the inline vocabulary holds; the
 * marker-rewriting behaviors belong only to kinds whose markers the reveal can address; no two mark
 * rows claim one nesting rank or one command; and no plugin row's mark claims a built-in command id.
 * A mistyped kind is silent, a rewrite on a never-revealed kind edits markers the author cannot see,
 * and a tied or built-in command leaves which meaning answers to each surface's own lookup order.
 */
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
				message: `inline-construct policy registered for "${entry.kind}", which is neither a built-in inline kind nor a declared plugin one — the row is unreachable`,
				detail: { kind: entry.kind, issue: 'unknown-kind' }
			};
		}
		if (entry.mark) {
			const clash = markClashOf(entry.kind, entry.mark, ranks, commands);
			if (clash) return clash;
			// The built-in vocabulary is closed and every id in it already answers somewhere, so a
			// plugin mark claiming one shadows that meaning on whichever surface consults the mark
			// table first — and the surfaces do not agree on where in their lookup that is.
			if (!isBuiltinInlineKind(entry.kind) && isBuiltinCommandId(entry.mark.command)) {
				return {
					code: 'inline-construct-policy',
					message: `kind "${entry.kind}" claims built-in command "${entry.mark.command}" for its mark — that id already has a built-in meaning; mint a plugin command id for the mark`,
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
				message: `kind "${entry.kind}" is not revealable but its ${column} rewrites markers — a never-revealed construct's markers stay hidden, so the rewrite is invisible; mark the kind revealable or make the behavior atomic`,
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
			message: `kinds "${rankHolder}" and "${kind}" share mark nesting rank ${mark.nestingRank} — which one wraps the other would fall to registration order`,
			detail: { kinds: [rankHolder, kind], nestingRank: mark.nestingRank }
		};
	}
	const commandHolder = commands.get(mark.command);
	if (commandHolder !== undefined) {
		return {
			code: 'inline-construct-policy',
			message: `kinds "${commandHolder}" and "${kind}" both claim command "${mark.command}" — one press cannot toggle two marks`,
			detail: { kinds: [commandHolder, kind], command: mark.command }
		};
	}
	ranks.set(mark.nestingRank, kind);
	commands.set(mark.command, kind);
	return null;
}

export interface DescriptorFieldEntry {
	kind: AnyBlockKind;
	declaresWholeBlockFocus: boolean;
	supportsInline: boolean;
	declaresReservedChrome: boolean;
	contextDependentKind: boolean;
	hasOpener: boolean;
	unwrapLiftsFirstChild: boolean;
	unwrapKeepsReservedChrome: boolean;
}

/**
 * G1.37 — descriptor-vs-descriptor coherence: field pairs the type can represent and the kind
 * cannot mean together. Each is silently inert rather than loud, so nothing fails until a
 * gesture reaches the kind. G1.24 is the sibling over closure cells; this one reads the
 * declarations alone.
 */
export function checkDescriptorFieldCoherence(
	entries: readonly DescriptorFieldEntry[]
): InvariantViolation | null {
	for (const entry of entries) {
		if (entry.contextDependentKind && entry.hasOpener) {
			return {
				code: 'descriptor-field-coherence',
				message: `kind "${entry.kind}" declares contextDependentKind but registers an opener — the field suppresses the reparse that would re-derive the kind, so a kind the parser CAN recognize stops re-deriving; drop one`,
				detail: { kind: entry.kind, fields: ['contextDependentKind', 'opener'] }
			};
		}
		if (entry.declaresWholeBlockFocus && entry.supportsInline) {
			return {
				code: 'descriptor-field-coherence',
				message: `kind "${entry.kind}" declares blockFocus: 'whole-block' and supportsInline — a whole-block unit's only addressable offsets are 0 and its display length, so inline constructs parsed from its raw have no caret positions to live at`,
				detail: { kind: entry.kind, fields: ['blockFocus', 'supportsInline'] }
			};
		}
		if (entry.declaresWholeBlockFocus && entry.declaresReservedChrome) {
			return {
				code: 'descriptor-field-coherence',
				message: `kind "${entry.kind}" declares blockFocus: 'whole-block' and reservedChrome — the chrome slot is always present, so the kind is never childless and the focus-then-delete model it declares can never engage`,
				detail: { kind: entry.kind, fields: ['blockFocus', 'reservedChrome'] }
			};
		}
		if (entry.declaresReservedChrome && entry.unwrapLiftsFirstChild) {
			return {
				code: 'descriptor-field-coherence',
				message: `kind "${entry.kind}" declares reservedChrome and a lifting firstChildBackspace — child 0 is the chrome row, so Backspace at its start would carry the container's own title out as a sibling block; declare 'keep-reserved-chrome'`,
				detail: { kind: entry.kind, fields: ['reservedChrome', 'firstChildBackspace'] }
			};
		}
		if (entry.unwrapKeepsReservedChrome && !entry.declaresReservedChrome) {
			return {
				code: 'descriptor-field-coherence',
				message: `kind "${entry.kind}" declares firstChildBackspace: 'keep-reserved-chrome' without reservedChrome — child 0 is body, so the declared decline makes Backspace at the body start a dead key; declare a lifting strategy`,
				detail: { kind: entry.kind, fields: ['reservedChrome', 'firstChildBackspace'] }
			};
		}
	}
	return null;
}

export interface ContentStartBackspaceEntry {
	kind: AnyBlockKind;
	demotesFirst: boolean;
	declaresContentRange: boolean;
}

/**
 * G1.32 — a kind demoting on Backspace at its content start declares where that content starts.
 * Without the hook the content range IS the whole display, so the arm never fires and the
 * declaration reads as behavior the kind does not have — silent, and only at the keystroke.
 */
export function checkContentStartBackspace(
	entries: readonly ContentStartBackspaceEntry[]
): InvariantViolation | null {
	for (const { kind, demotesFirst, declaresContentRange } of entries) {
		if (!demotesFirst || declaresContentRange) continue;
		return {
			code: 'content-start-backspace',
			message: `kind "${kind}" declares contentStartBackspace but no getContentRange — its content starts at raw 0, where the demote arm never fires and the declaration is silently inert`,
			detail: { kind }
		};
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
