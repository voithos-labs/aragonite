import type { AnyBlockKind, BlockKind } from '../core/nodes';
import { ALL_BLOCK_KINDS } from '../core/nodes';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { getBlockComponent } from '../schema/block-component-registry';
import { listRegisteredOpeners } from '../schema/block-openers';
import type { InvariantViolation } from './assert';

/**
 * Registry predicates accept their lookups as parameters (real ones as
 * defaults) so negative tests inject a missing/mismatched entry without
 * mutating the module-global registries other tests depend on.
 */

/**
 * G1.2 — every BlockKind resolves to both a descriptor and a component.
 * Returns the first gap. NOTE: over the real registries this currently fires
 * on `listItem` (no registered component — items render inside their parent
 * list); Task 2 adds the BlockHost fallback that makes that gap benign.
 */
export function checkRegistryCompleteness(
	kinds: BlockKind[] = ALL_BLOCK_KINDS,
	hasDescriptor: (kind: BlockKind) => boolean = (kind) =>
		tryGetBlockKindDescriptor(kind) !== undefined,
	hasComponent: (kind: BlockKind) => boolean = (kind) => getBlockComponent(kind) !== undefined
): InvariantViolation | null {
	for (const kind of kinds) {
		if (!hasDescriptor(kind)) {
			return {
				code: 'registry-incomplete',
				message: `kind "${kind}" has no registered descriptor`,
				detail: { kind, missing: 'descriptor' }
			};
		}
		if (!hasComponent(kind)) {
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
 * G1.3 — a kind is a container iff its descriptor supplies `rebuildRaw`.
 * Checked after container-raw augmentation has run. Reports the first kind
 * where `isContainer` and `rebuildRaw`-presence disagree.
 */
export function checkIsContainerIffRebuildRaw(
	kinds: BlockKind[] = ALL_BLOCK_KINDS,
	getPairing: (kind: BlockKind) => { isContainer: boolean; hasRebuildRaw: boolean } = (kind) => {
		const d = tryGetBlockKindDescriptor(kind);
		return { isContainer: d?.isContainer ?? false, hasRebuildRaw: d?.rebuildRaw !== undefined };
	}
): InvariantViolation | null {
	for (const kind of kinds) {
		const { isContainer, hasRebuildRaw } = getPairing(kind);
		if (isContainer !== hasRebuildRaw) {
			return {
				code: 'container-rebuild-pairing',
				message: `kind "${kind}" ${isContainer ? 'is a container but has no rebuildRaw' : 'has rebuildRaw but is not a container'}`,
				detail: { kind, isContainer, hasRebuildRaw }
			};
		}
	}
	return null;
}

/**
 * G1.10 — opener-registry coherence: every registered opener belongs to a
 * registered kind, and priorities are unique (equal priorities make dispatch
 * order registration-dependent — a silent round-trip hazard).
 */
export function checkOpenerRegistry(
	entries: { kind: AnyBlockKind; priority: number }[] = listRegisteredOpeners(),
	hasDescriptor: (kind: AnyBlockKind) => boolean = (kind) =>
		tryGetBlockKindDescriptor(kind) !== undefined
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
				message: `kinds "${holder}" and "${kind}" share opener priority ${priority}`,
				detail: { kinds: [holder, kind], priority }
			};
		}
		seen.set(priority, kind);
	}
	return null;
}
