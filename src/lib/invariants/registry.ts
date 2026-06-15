import type { AnyBlockKind, BlockKind } from '../core/nodes';
import { ALL_BLOCK_KINDS } from '../core/nodes';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { getBlockComponent } from '../schema/block-component-registry';
import { listRegisteredOpeners } from '../schema/block-openers';
import { GLOBAL_COMMAND_IDS, BLOCK_COMMAND_IDS } from '../schema/commands';
import { normalizeChord, type KeyBinding } from '../schema/keybindings';
import type { InvariantViolation } from './assert';

/**
 * Registry predicates accept their lookups as parameters (real ones as
 * defaults) so negative tests inject a missing/mismatched entry without
 * mutating the module-global registries other tests depend on.
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
 * G1.3 — a kind is a container iff its descriptor supplies `rebuildRaw`.
 * rebuildRaw is declared at registration. Reports the first kind where
 * `isContainer` and `rebuildRaw`-presence disagree.
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

/**
 * G1.11 — keymap coherence: every keymap binding names a known command, and a
 * kind's chords are unique after normalization (duplicates make dispatch order
 * declaration-dependent). Chords are scoped per kind — two kinds may bind the
 * same chord to different commands. Reports the first offending binding.
 */
export function checkKeymapCoherence(
	entries: { kind: AnyBlockKind; keymap?: KeyBinding[] }[] = ALL_BLOCK_KINDS.map((kind) => ({
		kind,
		keymap: tryGetBlockKindDescriptor(kind)?.keymap
	}))
): InvariantViolation | null {
	const knownCommands = new Set<string>([...GLOBAL_COMMAND_IDS, ...BLOCK_COMMAND_IDS]);
	for (const { kind, keymap } of entries) {
		if (!keymap) continue;
		const seenChords = new Set<string>();
		for (const binding of keymap) {
			if (!knownCommands.has(binding.command)) {
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
