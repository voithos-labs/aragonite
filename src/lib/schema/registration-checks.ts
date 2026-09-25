/**
 * Checks that the registrations agree with each other. The registries queue every registration
 * made after startup, and this module checks them at the next opportunity: an Editor mount, or the
 * parser's next read of the grammar (`getOrderedOpeners`). Never part-way through a batch, so one
 * registration referring forward to another in the same batch warns about nothing. This module and
 * `block-openers` name each other, but only inside function bodies, so neither runs while the
 * other is still evaluating.
 */
import {
	ALL_BLOCK_KINDS,
	isBuiltinInlineKind,
	type AnyBlockKind,
	type AnyInlineKind
} from '../core/nodes';
import type { ClosureCell } from './closure';
import { assertInvariant, type InvariantViolation } from '../assert';
import {
	checkRegistryCompleteness,
	checkOpenerRegistry,
	checkKeymapCoherence,
	checkReservedChromeCoherence,
	checkClosureCoherence,
	checkLateOpenerRegistration,
	checkMergeRoleVocabulary,
	checkContentStartBackspace,
	checkDescriptorFieldCoherence,
	checkInlineConstructPolicy,
	type ClosureCoherenceEntry,
	type ContentStartBackspaceEntry,
	type DescriptorFieldEntry,
	type MergeRoleEntry
} from '../invariants/registry';
import { listInlineConstructPolicies } from './inline-construct-policy';
import { isInlineKindDeclared } from './plugin-kind';
import {
	tryGetBlockKindDescriptor,
	getAllRegisteredKinds,
	isKnownMergeRole,
	liftsFirstChild,
	type BlockKindDescriptor
} from './block-kind-descriptor';
import { isBlockComponentRegistered } from './block-component-registry';
import { listRegisteredOpeners } from './block-openers';
import { isBuiltinCommandId } from './commands';
import { isPluginCommandId } from './command-id';
import { normalizeChord, isChordWellFormed } from './keybindings';
import {
	takeRegistrationFlushWork,
	__resetRegistrationChecksForTests
} from './registration-pending';
import { enrollTestReset } from './register-once';

export {
	hasPendingRegistrationChecks,
	__resetRegistrationChecksForTests
} from './registration-pending';

// A flag left behind by a cleared registry would make the next registrations look late.
enrollTestReset(__resetRegistrationChecksForTests);

/** The same shape as `assertInvariant`, which is the default; tests pass a collector instead. */
export type RegistrationCheckReport = (tag: string, check: () => InvariantViolation | null) => void;

const hasDescriptor = (kind: AnyBlockKind): boolean =>
	tryGetBlockKindDescriptor(kind) !== undefined;

const hasComponent = (kind: AnyBlockKind): boolean => isBlockComponentRegistered(kind);

const keymapEntries = (kinds: readonly AnyBlockKind[]) =>
	kinds.map((kind) => ({ kind, keymap: tryGetBlockKindDescriptor(kind)?.keymap }));

const reservedChromeEntries = (kinds: readonly AnyBlockKind[]) =>
	kinds.map((kind) => {
		const d = tryGetBlockKindDescriptor(kind);
		return {
			kind,
			isContainer: d?.isContainer ?? false,
			reservedChromeKind: d?.reservedChrome?.kind
		};
	});

const viaOf = (cell: ClosureCell): string | undefined =>
	cell.mode === 'implemented' ? cell.via : undefined;

/**
 * Turns a descriptor into the entry the G1.24 check reads. Exported so the suites build it the
 * same way: a test-local copy missing a field would pass while the rule it tests went unchecked.
 */
export const closureCoherenceEntry = (
	kind: AnyBlockKind,
	d: BlockKindDescriptor
): ClosureCoherenceEntry => ({
	kind,
	notMergeable: d.mergeRole === 'not-mergeable',
	hasContainerContract: d.containerContract !== undefined,
	roundTripMode: d.closure.roundTrip.mode,
	mergeBackspaceMode: d.closure.mergeBackspace.mode,
	declaresWholeBlockFocus: d.blockFocus === 'whole-block',
	focusVia: viaOf(d.closure.focus),
	mergeBackspaceVia: viaOf(d.closure.mergeBackspace),
	declaresReservedChrome: d.reservedChrome !== undefined,
	clipboardMode: d.closure.clipboard.mode
});

const closureEntries = (kinds: readonly AnyBlockKind[]) =>
	kinds
		.map((kind) => ({ kind, d: tryGetBlockKindDescriptor(kind) }))
		.filter((e): e is { kind: AnyBlockKind; d: NonNullable<typeof e.d> } => e.d !== undefined)
		.map(({ kind, d }) => closureCoherenceEntry(kind, d));

// Widened to `string` on the way out: the check exists for the callers the `MergeRole` union
// cannot constrain, such as a plugin registering through a cast.
const mergeRoleEntries = (kinds: readonly AnyBlockKind[]): MergeRoleEntry[] =>
	kinds.flatMap((kind) => {
		const mergeRole: string | undefined = tryGetBlockKindDescriptor(kind)?.mergeRole;
		return mergeRole === undefined ? [] : [{ kind, mergeRole }];
	});

const contentStartBackspaceEntries = (
	kinds: readonly AnyBlockKind[]
): ContentStartBackspaceEntry[] =>
	kinds.map((kind) => {
		const d = tryGetBlockKindDescriptor(kind);
		return {
			kind,
			demotesFirst: d?.contentStartBackspace === 'demote-first',
			declaresContentRange: d?.getContentRange !== undefined
		};
	});

const descriptorFieldEntries = (
	kinds: readonly AnyBlockKind[],
	openerKinds: ReadonlySet<AnyBlockKind>
): DescriptorFieldEntry[] =>
	kinds.flatMap((kind) => {
		const d = tryGetBlockKindDescriptor(kind);
		if (!d) return [];
		const firstChildBackspace = d.unwrapRole?.firstChildBackspace;
		return [
			{
				kind,
				declaresWholeBlockFocus: d.blockFocus === 'whole-block',
				supportsInline: d.supportsInline,
				declaresReservedChrome: d.reservedChrome !== undefined,
				contextDependentKind: d.contextDependentKind === true,
				hasOpener: openerKinds.has(kind),
				unwrapLiftsFirstChild:
					firstChildBackspace !== undefined && liftsFirstChild(firstChildBackspace),
				unwrapKeepsReservedChrome: firstChildBackspace === 'keep-reserved-chrome'
			}
		];
	});

const isKnownCommandId = (id: string): boolean => isBuiltinCommandId(id) || isPluginCommandId(id);

/**
 * Run the registry checks (G1.2/10/11/17/18/24/30/32/37). The first call covers everything
 * registered; later calls check only the kinds registered since, plus the openers as a whole,
 * because a new opener's priority clash always involves another entry.
 */
export function flushPendingRegistrationChecks(
	report: RegistrationCheckReport = assertInvariant
): void {
	const work = takeRegistrationFlushWork();
	if (!work) return;
	if (work.firstFlush) {
		report('registry-completeness', () =>
			checkRegistryCompleteness(ALL_BLOCK_KINDS, hasDescriptor, hasComponent)
		);
	}
	// The first run covers the live registry, not only `ALL_BLOCK_KINDS`. The completeness check
	// stays limited to built-ins, since a plugin kind's component may register later; the
	// reserved-chrome check covers plugin kinds at startup instead.
	const kinds = work.firstFlush ? getAllRegisteredKinds() : work.kinds;
	report('opener-registry', () => checkOpenerRegistry(listRegisteredOpeners(), hasDescriptor));
	report('keymap-coherence', () =>
		checkKeymapCoherence(keymapEntries(kinds), isKnownCommandId, normalizeChord, isChordWellFormed)
	);
	report('reserved-chrome-coherence', () =>
		checkReservedChromeCoherence(reservedChromeEntries(kinds), hasDescriptor, hasComponent)
	);
	report('closure-coherence', () => checkClosureCoherence(closureEntries(kinds)));
	report('descriptor-field-coherence', () =>
		checkDescriptorFieldCoherence(
			descriptorFieldEntries(kinds, new Set(listRegisteredOpeners().map((entry) => entry.kind)))
		)
	);
	report('merge-role-vocabulary', () =>
		checkMergeRoleVocabulary(mergeRoleEntries(kinds), isKnownMergeRole)
	);
	report('content-start-backspace', () =>
		checkContentStartBackspace(contentStartBackspaceEntries(kinds))
	);
	for (const kind of work.lateOpeners) {
		report('late-opener-registration', () => checkLateOpenerRegistration(kind, true));
	}
}

const isKnownInlineKind = (kind: AnyInlineKind): boolean =>
	isBuiltinInlineKind(kind) || isInlineKindDeclared(kind);

/**
 * G1.31, run only when an Editor mounts. The rows register with the descriptors, but the policy's
 * functions come from the component layer, which a parse-only unit test never loads, so running
 * this at the parser's check would fire on an absence that is legal there. It reads the whole
 * table rather than one registration, so it stays off the queue of pending kinds.
 */
export function checkInlineConstructPoliciesAtMount(
	report: RegistrationCheckReport = assertInvariant
): void {
	report('inline-construct-policy', () =>
		checkInlineConstructPolicy(
			listInlineConstructPolicies(),
			isKnownInlineKind,
			isBuiltinInlineKind,
			isBuiltinCommandId
		)
	);
}
