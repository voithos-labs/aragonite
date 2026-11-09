/**
 * Checks that the registrations agree with each other. Registrations made after startup queue up
 * and are checked at the next Editor mount or parser read of the grammar, never part-way through a
 * batch, so a forward reference within one batch warns about nothing.
 */
import {
	ALL_BLOCK_KINDS,
	isBuiltinBlockKind,
	isBuiltinInlineKind,
	type AnyBlockKind,
	type AnyInlineKind
} from '../core/nodes';
import {
	assertInvariant,
	devChecksOn,
	type InvariantViolation
} from '@voithos-labs/aragonite/dev-checks';
import {
	checkRegistryCompleteness,
	checkOpenerRegistry,
	checkKeymapCoherence,
	checkReservedChromeCoherence,
	checkLateOpenerRegistration,
	checkMergeRoleVocabulary,
	checkInlineConstructPolicy,
	checkBuiltinPresentationFacts,
	type MergeRoleEntry,
	type PresentationFactEntry
} from '../invariants/registry';
import { listInlineConstructPolicies } from './inline-construct-policy';
import { isInlineKindDeclared } from './plugin-kind';
import {
	tryGetBlockKindDescriptor,
	getAllRegisteredKinds,
	openerRecords,
	isKnownMergeRole
} from './block-kind-descriptor';
import { reservedChromeKindOf } from './reserved-chrome';
import { isBuiltinCommandId } from './commands';
import { isPluginCommandId } from './command-id';
import { takeRegistrationFlushWork } from './registration-pending';

export { hasPendingRegistrationChecks } from './registration-pending';

/** The same shape as `assertInvariant`, which is the default; tests pass a collector instead. */
export type RegistrationCheckReport = (tag: string, check: () => InvariantViolation | null) => void;

const hasDescriptor = (kind: AnyBlockKind): boolean =>
	tryGetBlockKindDescriptor(kind) !== undefined;

const openerPriorities = () =>
	openerRecords().map(({ key, value }) => ({ kind: key, priority: value.priority }));

const keymapEntries = (kinds: readonly AnyBlockKind[]) =>
	kinds.map((kind) => ({ kind, keymap: tryGetBlockKindDescriptor(kind)?.keymap }));

const reservedChromeEntries = (kinds: readonly AnyBlockKind[]) =>
	kinds.map((kind) => ({
		kind,
		reservedChromeKind: tryGetBlockKindDescriptor(kind)?.reservedChrome?.kind,
		rowKind: reservedChromeKindOf(kind)
	}));

// Widened to `string` on the way out: the check exists for the callers the `MergeRole` union
// cannot constrain, such as a plugin registering through a cast.
const mergeRoleEntries = (kinds: readonly AnyBlockKind[]): MergeRoleEntry[] =>
	kinds.flatMap((kind) => {
		const mergeRole: string | undefined = tryGetBlockKindDescriptor(kind)?.mergeRole;
		return mergeRole === undefined ? [] : [{ kind, mergeRole }];
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
	// `report` is a parameter, so a bundler can't tell it does nothing in production; reading the
	// switch here lets a production build drop the checks.
	if (!devChecksOn) return;
	const work = takeRegistrationFlushWork();
	if (!work) return;
	if (work.firstFlush) {
		report('registry-completeness', () =>
			checkRegistryCompleteness(ALL_BLOCK_KINDS, hasDescriptor)
		);
	}
	// The first run covers every registered kind, plugin kinds included; the completeness check
	// stays on built-ins, the one closed set.
	const kinds = work.firstFlush ? getAllRegisteredKinds() : work.kinds;
	report('opener-registry', () => checkOpenerRegistry(openerPriorities()));
	report('keymap-coherence', () => checkKeymapCoherence(keymapEntries(kinds), isKnownCommandId));
	report('reserved-chrome-coherence', () =>
		checkReservedChromeCoherence(reservedChromeEntries(kinds), hasDescriptor)
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
	if (!devChecksOn) return;
	report('inline-construct-policy', () =>
		checkInlineConstructPolicy(
			listInlineConstructPolicies(),
			isKnownInlineKind,
			isBuiltinInlineKind,
			isBuiltinCommandId
		)
	);
}
