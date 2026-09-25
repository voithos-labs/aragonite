/**
 * The plugin command id: a branded string created by `mintCommandId`, mirroring the
 * `PluginBlockKind` brand in `core/nodes`. Built-in `CommandId` switches stay exhaustive while
 * the block-command registry keys plugin ids. Register-once.
 */
import { isBuiltinCommandId, type CommandId } from './commands';
import { currentInstallingPlugin } from './plugin-install';
import { createPluginRegistry } from './plugin-registry';

declare const PluginCommandIdBrand: unique symbol;
export type PluginCommandId = string & { readonly [PluginCommandIdBrand]: true };

export type AnyCommandId = CommandId | PluginCommandId;

const NAME_PATTERN = /^[a-z][a-zA-Z0-9-]*(\.[a-z][a-zA-Z0-9-]*)*$/;

// The owner is the plugin installing when the id was created, which tells a plugin re-creating
// its own id apart from a cross-plugin collision.
const mintedCommandIds = createPluginRegistry<string, true>({
	label: 'mintCommandId',
	isBuiltin: () => false
});

/**
 * Create (or look up) a plugin command id. Names are global but dispatch is per kind, so the
 * plugin that created a name gets the existing id when it asks again; a different plugin (or a
 * call outside any install) throws, naming the prior owner.
 */
export function mintCommandId(name: string): PluginCommandId {
	if (!NAME_PATTERN.test(name)) {
		throw new Error(
			`mintCommandId: invalid command name "${name}"; lowercase-first dot-separated segments of letters, digits, and hyphens`
		);
	}
	if (isBuiltinCommandId(name)) {
		throw new Error(`mintCommandId: "${name}" is a built-in command id`);
	}
	const owner = currentInstallingPlugin();
	const priorOwner = mintedCommandIds.ownerOf(name);
	if (mintedCommandIds.has(name) && owner !== null && owner === priorOwner) {
		return name as PluginCommandId;
	}
	mintedCommandIds.register(
		name,
		true,
		`mintCommandId: "${name}" was already taken by ${priorOwner ? `plugin "${priorOwner}"` : 'another registration'}`
	);
	return name as PluginCommandId;
}

export function isPluginCommandId(id: string): id is PluginCommandId {
	return mintedCommandIds.has(id);
}
