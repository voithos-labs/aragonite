/**
 * Registration-seam coherence. The registries enqueue every post-bootstrap
 * registration (via `./registration-pending`) and this seam validates them at
 * the next flush — Editor mount (`runStartupInvariantChecks`) or the parser's
 * next grammar read (`getOrderedOpeners`) — never mid-batch, so intra-batch
 * forward references (an opener before its descriptor, `reservedChrome`
 * naming a later chrome kind) stay warn-free.
 *
 * This module and block-openers reference each other (flush trigger one way,
 * `listRegisteredOpeners` the other) — a cycle whose references all sit inside
 * function bodies. Neither module calls the other during evaluation (built-in
 * openers register from `core/parsers`), so evaluation order cannot observe
 * uninitialized state.
 */
import { ALL_BLOCK_KINDS, type AnyBlockKind } from '../core/nodes';
import { assertInvariant, type InvariantViolation } from '../invariants/assert';
import {
	checkRegistryCompleteness,
	checkIsContainerIffRebuildRaw,
	checkOpenerRegistry,
	checkKeymapCoherence,
	checkLateOpenerRegistration
} from '../invariants/registry';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';
import { getBlockComponent } from './block-component-registry';
import { listRegisteredOpeners } from './block-openers';
import { isBuiltinCommandId } from './commands';
import { isPluginCommandId } from './command-id';
import { normalizeChord } from './keybindings';
import { takeRegistrationFlushWork } from './registration-pending';

export {
	enqueueRegistrationCheck,
	markGrammarConsumed,
	hasPendingRegistrationChecks,
	__resetRegistrationChecksForTests
} from './registration-pending';

/** Matches `assertInvariant` — the default sink; tests inject a collector. */
export type RegistrationCheckReport = (tag: string, check: () => InvariantViolation | null) => void;

const hasDescriptor = (kind: AnyBlockKind): boolean =>
	tryGetBlockKindDescriptor(kind) !== undefined;

const pairingOf = (kind: AnyBlockKind): { isContainer: boolean; hasRebuildRaw: boolean } => {
	const d = tryGetBlockKindDescriptor(kind);
	return { isContainer: d?.isContainer ?? false, hasRebuildRaw: d?.rebuildRaw !== undefined };
};

const keymapEntries = (kinds: readonly AnyBlockKind[]) =>
	kinds.map((kind) => ({ kind, keymap: tryGetBlockKindDescriptor(kind)?.keymap }));

const isKnownCommandId = (id: string): boolean => isBuiltinCommandId(id) || isPluginCommandId(id);

/**
 * Run the registry coherence checks (G1.2/3/10/11/17). First call sweeps the
 * whole world — bootstrap semantics; later calls validate only the kinds
 * registered since the previous flush, plus opener coherence over the full
 * registry (a new opener's priority collision is inherently cross-entry).
 */
export function flushPendingRegistrationChecks(
	report: RegistrationCheckReport = assertInvariant
): void {
	const work = takeRegistrationFlushWork();
	if (!work) return;
	if (work.firstFlush) {
		report('registry-completeness', () =>
			checkRegistryCompleteness(
				ALL_BLOCK_KINDS,
				hasDescriptor,
				(kind) => getBlockComponent(kind) !== undefined
			)
		);
	}
	const kinds = work.firstFlush ? ALL_BLOCK_KINDS : work.kinds;
	report('container-rebuild-pairing', () => checkIsContainerIffRebuildRaw(kinds, pairingOf));
	report('opener-registry', () => checkOpenerRegistry(listRegisteredOpeners(), hasDescriptor));
	report('keymap-coherence', () =>
		checkKeymapCoherence(keymapEntries(kinds), isKnownCommandId, normalizeChord)
	);
	for (const kind of work.lateOpeners) {
		report('late-opener-registration', () => checkLateOpenerRegistration(kind, true));
	}
}
