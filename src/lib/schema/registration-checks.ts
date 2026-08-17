/**
 * Registration-seam coherence: the registries enqueue every post-bootstrap registration and this
 * seam validates them at the next flush — Editor mount, or the parser's next grammar read
 * (`getOrderedOpeners`) — never mid-batch, so intra-batch forward references stay warn-free.
 * This module and block-openers reference each other, but only inside function bodies, and
 * neither calls the other during evaluation, so no cycle observes uninitialized state.
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
	checkInlineConstructPolicy,
	type ClosureCoherenceEntry,
	type ContentStartBackspaceEntry,
	type MergeRoleEntry
} from '../invariants/registry';
import { listInlineConstructPolicies } from './inline-construct-policy';
import { isInlineKindDeclared } from './plugin-kind';
import {
	tryGetBlockKindDescriptor,
	getAllRegisteredKinds,
	isKnownMergeRole,
	type BlockKindDescriptor
} from './block-kind-descriptor';
import { getBlockComponent } from './block-component-registry';
import { listRegisteredOpeners } from './block-openers';
import { isBuiltinCommandId } from './commands';
import { isPluginCommandId } from './command-id';
import { normalizeChord, isChordWellFormed } from './keybindings';
import { takeRegistrationFlushWork } from './registration-pending';

export {
	hasPendingRegistrationChecks,
	__resetRegistrationChecksForTests
} from './registration-pending';

/** Matches `assertInvariant` — the default sink; tests inject a collector. */
export type RegistrationCheckReport = (tag: string, check: () => InvariantViolation | null) => void;

const hasDescriptor = (kind: AnyBlockKind): boolean =>
	tryGetBlockKindDescriptor(kind) !== undefined;

const hasComponent = (kind: AnyBlockKind): boolean => getBlockComponent(kind) !== undefined;

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
 * Descriptor → G1.24 entry. Exported so the suites project the same fields: a test-local copy
 * that missed a column would pass while the rule it claims to exercise went unread.
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

// Widened to `string` on the way out: the vocabulary check exists for the callers the
// `MergeRole` union cannot bind (a plugin registering through a cast).
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

const isKnownCommandId = (id: string): boolean => isBuiltinCommandId(id) || isPluginCommandId(id);

/**
 * Run the registry coherence checks (G1.2/10/11/17/18/24/30). The first call sweeps the whole
 * world; later calls validate only the kinds registered since, plus opener coherence over the
 * full registry (a new opener's priority collision is inherently cross-entry).
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
	// The first flush sweeps the live registry, not just ALL_BLOCK_KINDS. Completeness stays
	// built-in-scoped: a plugin kind's component may register on its own schedule, so
	// reservedChrome coherence is the plugin-kind bootstrap check instead.
	const kinds = work.firstFlush ? getAllRegisteredKinds() : work.kinds;
	report('opener-registry', () => checkOpenerRegistry(listRegisteredOpeners(), hasDescriptor));
	report('keymap-coherence', () =>
		checkKeymapCoherence(keymapEntries(kinds), isKnownCommandId, normalizeChord, isChordWellFormed)
	);
	report('reserved-chrome-coherence', () =>
		checkReservedChromeCoherence(reservedChromeEntries(kinds), hasDescriptor, hasComponent)
	);
	report('closure-coherence', () => checkClosureCoherence(closureEntries(kinds)));
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
 * G1.31, at the EDITOR-MOUNT flush alone. The rows register with the descriptors, but the
 * policy's function hooks patch in from the component layer, which a parse-only unit test
 * never loads — running this at the parser's flush would fire on an absence legal there.
 * Table-wide rather than per-registration, so it does not ride the pending-kinds queue.
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
