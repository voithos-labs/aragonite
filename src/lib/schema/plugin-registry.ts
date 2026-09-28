/**
 * The store every registration a plugin can reach is built on. A registry is register-once (a
 * dev server replaces), answers reads only through an editor's `PluginActivation`, and is cleared
 * by the test reset except for built-ins. An entry answers to the plugin whose setup registered
 * it, or in a kind registry to the plugin that declared the kind, whoever registered the entry.
 */
import type { AnyBlockKind, AnyInlineKind } from '../core/nodes';
import { currentInstallingPlugin } from './plugin-install';
import { resolvesIn, type PluginActivation } from './plugin-activation';
import { registerOnce } from './register-once';
import { enrollTestReset } from './registry-reset';
// Last: `plugin-kind` builds its registries at load, so everything they call must be loaded first.
import { pluginInlineKindOwner, pluginKindOwner } from './plugin-kind';

export interface RegistryRecord<K, V> {
	readonly key: K;
	readonly value: V;
	/** The plugin whose activation the entry answers to. */
	readonly owner: string | null;
}

export interface PluginRegistry<K, V> {
	/** Throws on a taken key, `conflict` being the message; a dev server replaces instead. */
	register(key: K, value: V, conflict?: string): void;
	/** Replace a registered key's value in place, keeping its owner and its position. */
	update(key: K, value: V): void;
	/** Registration-time question, blind to activation: is the key taken? */
	has(key: K): boolean;
	ownerOf(key: K): string | null;
	/** The value where `activation` resolves its owner (`resolvesIn`), else undefined. */
	get(key: K, activation: PluginActivation): V | undefined;
	/** Every entry `activation` resolves, in registration order. */
	entries(activation: PluginActivation): [K, V][];
	/** For a read whose key only an already-filtered route can produce, or that must see every
	 *  entry (a descriptor, a registration check). */
	getIgnoringActivation(key: K): V | undefined;
	/** Every entry with its owner, in registration order, for an index a module derives and
	 *  filters with `resolvesIn` at its own read. */
	records(): RegistryRecord<K, V>[];
}

/** A registry keyed by a block or inline kind: every entry answers to the kind's declarer. */
export type KindRegistry<K, V> = PluginRegistry<K, V>;

export interface PluginRegistryOptions<K> {
	/** The registering function's name, which starts the default duplicate message. */
	label: string;
	/** A built-in key survives the test reset when no plugin owns it. */
	isBuiltin: (key: K) => boolean;
	/** Runs after every change, the reset included, so a derived cache can drop itself. */
	onChange?: () => void;
}

// A kind-typed key leaves this property unsatisfiable, so a kind's entries cannot be built into a
// registry that answers to the registering plugin instead of the kind's declarer.
type RefuseKindKey<K> = [K] extends [AnyBlockKind | AnyInlineKind]
	? { kindKeysGoInACreateKindRegistry: never }
	: unknown;

export function createPluginRegistry<K, V>(
	options: PluginRegistryOptions<K> & RefuseKindKey<K>
): PluginRegistry<K, V> {
	return buildRegistry<K, V>(options, (_key, registrant) => registrant);
}

export function createBlockKindRegistry<V>(
	options: PluginRegistryOptions<AnyBlockKind>
): KindRegistry<AnyBlockKind, V> {
	return buildRegistry<AnyBlockKind, V>(options, pluginKindOwner);
}

export function createInlineKindRegistry<V>(
	options: PluginRegistryOptions<AnyInlineKind>
): KindRegistry<AnyInlineKind, V> {
	return buildRegistry<AnyInlineKind, V>(options, pluginInlineKindOwner);
}

// ── Internal ─────────────────────────────────────────────────────────────────

type AnswersTo<K> = (key: K, registrant: string | null) => string | null;

interface Entry<V> {
	value: V;
	registrant: string | null;
}

// Creating a registry enrolls its reset, so no registry can be left out of the reset.
function buildRegistry<K, V>(
	options: PluginRegistryOptions<K>,
	answersTo: AnswersTo<K>
): PluginRegistry<K, V> {
	const entries = new Map<K, Entry<V>>();
	const changed = () => options.onChange?.();
	const owner = (key: K, entry: Entry<V>) => answersTo(key, entry.registrant);

	enrollTestReset(() => {
		for (const [key, entry] of entries) {
			if (owner(key, entry) !== null || !options.isBuiltin(key)) entries.delete(key);
		}
		changed();
	});

	return {
		register(key, value, conflict) {
			const registrant = currentInstallingPlugin();
			registerOnce(
				entries.has(key),
				() => {
					entries.set(key, { value, registrant });
					changed();
				},
				conflict ??
					`${options.label}: "${String(key)}" is already registered. Registrations are register-once.`
			);
		},
		update(key, value) {
			const entry = entries.get(key);
			if (!entry)
				throw new Error(`${options.label}: cannot update "${String(key)}"; it is not registered`);
			entries.set(key, { ...entry, value });
			changed();
		},
		has: (key) => entries.has(key),
		ownerOf(key) {
			const entry = entries.get(key);
			return entry ? owner(key, entry) : null;
		},
		get(key, activation) {
			const entry = entries.get(key);
			return entry && resolvesIn(activation, owner(key, entry)) ? entry.value : undefined;
		},
		entries(activation) {
			const out: [K, V][] = [];
			for (const [key, entry] of entries) {
				if (resolvesIn(activation, owner(key, entry))) out.push([key, entry.value]);
			}
			return out;
		},
		getIgnoringActivation: (key) => entries.get(key)?.value,
		records: () =>
			[...entries].map(([key, entry]) => ({ key, value: entry.value, owner: owner(key, entry) }))
	};
}
