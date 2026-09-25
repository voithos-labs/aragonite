/**
 * The store every registration a plugin can reach is built on. A registry is register-once (a
 * dev server replaces), records the plugin whose setup made each entry, answers reads only
 * through an editor's `PluginActivation`, and is cleared by the test reset except for built-ins.
 * Creating one enrolls its reset, so no registry can be left out of the reset.
 */
import { currentInstallingPlugin } from './plugin-install';
import { resolvesIn, type PluginActivation } from './plugin-activation';
import { enrollTestReset, registerOnce } from './register-once';

export interface RegistryRecord<K, V> {
	readonly key: K;
	readonly value: V;
	/** The plugin whose setup registered the entry; null outside a plugin install. */
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

export interface PluginRegistryOptions<K> {
	/** The registering function's name, which starts the default duplicate message. */
	label: string;
	/** A built-in key survives the test reset when no plugin registered it. */
	isBuiltin: (key: K) => boolean;
	/** Runs after every change, the reset included, so a derived cache can drop itself. */
	onChange?: () => void;
}

export function createPluginRegistry<K, V>(
	options: PluginRegistryOptions<K>
): PluginRegistry<K, V> {
	const entries = new Map<K, { value: V; owner: string | null }>();
	const changed = () => options.onChange?.();

	enrollTestReset(() => {
		for (const [key, entry] of entries) {
			if (entry.owner !== null || !options.isBuiltin(key)) entries.delete(key);
		}
		changed();
	});

	return {
		register(key, value, conflict) {
			const owner = currentInstallingPlugin();
			registerOnce(
				entries.has(key),
				() => {
					entries.set(key, { value, owner });
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
			entries.set(key, { value, owner: entry.owner });
			changed();
		},
		has: (key) => entries.has(key),
		ownerOf: (key) => entries.get(key)?.owner ?? null,
		get(key, activation) {
			const entry = entries.get(key);
			return entry && resolvesIn(activation, entry.owner) ? entry.value : undefined;
		},
		entries(activation) {
			const out: [K, V][] = [];
			for (const [key, { value, owner }] of entries) {
				if (resolvesIn(activation, owner)) out.push([key, value]);
			}
			return out;
		},
		getIgnoringActivation: (key) => entries.get(key)?.value,
		records: () => [...entries].map(([key, { value, owner }]) => ({ key, value, owner }))
	};
}
