/**
 * Checks that the registrations agree with each other. Registrations made after startup queue up
 * and are checked at the next Editor mount or parser read of the grammar, never part-way through a
 * batch, so a forward reference within one batch warns about nothing. This module and
 * `block-openers` import each other for use inside function bodies only, so the cycle is safe.
 */
import {
	ALL_BLOCK_KINDS,
	isBuiltinBlockKind,
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
	checkDescriptorFieldCoherence,
	checkInlineConstructPolicy,
	checkBuiltinPresentationFacts,
	type ClosureCoherenceEntry,
	type DescriptorFieldEntry,
	type MergeRoleEntry,
	type PresentationFactEntry
} from '../invariants/registry';
import { listInlineConstructPolicies } from './inline-construct-policy';
import { isInlineKindDeclared } from './plugin-kind';
import {
	tryGetBlockKindDescriptor,
	getAllRegisteredKinds,
	isKnownMergeRole,
	type BlockKindDescriptor
} from './block-kind-descriptor';
import { isBlockComponentRegistered } from './block-component-registry';
import { listRegisteredOpeners } from './block-openers';
import { isBuiltinCommandId } from './commands';
import { isPluginCommandId } from './command-id';
import {
	takeRegistrationFlushWork,
	__resetRegistrationChecksForTests
} from './registration-pending';
import { enrollTestReset } from './registry-reset';

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
	kinds.map((kind) => ({
		kind,
		reservedChromeKind: tryGetBlockKindDescriptor(kind)?.reservedChrome?.kind
	}));

const viaOf = (cell: ClosureCell): string | undefined =>
	cell.mode === 'implemented' ? cell.via : undefined;

/**
 * The entry the closure coherence check reads (G1.24), exported so the suites build it the same
 * way: a test-local copy missing a field would pass while the rule it tests went unchecked.
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

const descriptorFieldEntries = (
	kinds: readonly AnyBlockKind[],
	openerKinds: ReadonlySet<AnyBlockKind>
): DescriptorFieldEntry[] =>
	kinds.flatMap((kind) => {
		const d = tryGetBlockKindDescriptor(kind);
		if (!d) return [];
		return [
			{
				kind,
				contextDependentKind: d.contextDependentKind === true,
				hasOpener: openerKinds.has(kind)
			}
		];
	});

const presentationFactEntries = (kinds: readonly AnyBlockKind[]): PresentationFactEntry[] =>
	kinds.filter(isBuiltinBlockKind).map((kind) => {
		const d = tryGetBlockKindDescriptor(kind);
		return {
			kind,
			declaresPageRole: d?.pageRole !== undefined,
			declaresEstimateHeight: d?.estimateHeight !== undefined
		};
	});

const isKnownCommandId = (id: string): boolean => isBuiltinCommandId(id) || isPluginCommandId(id);

/**
 * Run the registry checks. Later calls check only the kinds registered since the last, plus the
 * openers as a whole, since a new opener's priority clash always involves another entry.
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
	// The first run covers every registered kind, plugin kinds included; the completeness check
	// alone stays on built-ins, since a plugin kind's component may register later.
	const kinds = work.firstFlush ? getAllRegisteredKinds() : work.kinds;
	report('opener-registry', () => checkOpenerRegistry(listRegisteredOpeners(), hasDescriptor));
	report('keymap-coherence', () => checkKeymapCoherence(keymapEntries(kinds), isKnownCommandId));
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
	report('builtin-presentation-facts', () =>
		checkBuiltinPresentationFacts(presentationFactEntries(kinds))
	);
	for (const kind of work.lateOpeners) {
		report('late-opener-registration', () => checkLateOpenerRegistration(kind, true));
	}
}

const isKnownInlineKind = (kind: AnyInlineKind): boolean =>
	isBuiltinInlineKind(kind) || isInlineKindDeclared(kind);

/**
 * Mount-only, since the policy's functions come from the component layer, which a parse-only test
 * never loads (G1.31). It reads the whole table, so it stays off the queue of pending kinds.
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
