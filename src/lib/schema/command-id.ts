/**
 * The plugin command id: a branded string created by `mintCommandId`, mirroring the
 * `PluginBlockKind` brand in `core/nodes`. Built-in `CommandId` switches stay exhaustive while
 * the block-command registry keys plugin ids. Register-once.
 */
import { isBuiltinCommandId, type CommandId } from './commands';
import { devReplacesRegistration } from './register-once';

declare const PluginCommandIdBrand: unique symbol;
export type PluginCommandId = string & { readonly [PluginCommandIdBrand]: true };

export type AnyCommandId = CommandId | PluginCommandId;

const NAME_PATTERN = /^[a-z][a-zA-Z0-9-]*(\.[a-z][a-zA-Z0-9-]*)*$/;

// name → the plugin installing when the id was created (null outside an install). The owner
// tells a plugin re-creating its own id apart from a cross-plugin collision.
const mintedCommandIds = new Map<string, string | null>();

/**
 * Create (or look up) a plugin command id; `owner` is the installing plugin. Names are global but
 * dispatch is per kind, so the same owner asking for a name again gets the existing id; a
 * different plugin (or a call with no owner) throws, naming the prior owner.
 */
export function mintCommandId(name: string, owner: string | null = null): PluginCommandId {
	if (!NAME_PATTERN.test(name)) {
		throw new Error(
			`mintCommandId: invalid command name "${name}" — lowercase-first dot-separated segments of letters, digits, and hyphens`
		);
	}
	if (isBuiltinCommandId(name)) {
		throw new Error(`mintCommandId: "${name}" is a built-in command id`);
	}
	if (mintedCommandIds.has(name)) {
		const priorOwner = mintedCommandIds.get(name) ?? null;
		if (owner !== null && owner === priorOwner) return name as PluginCommandId;
		// A dev-server re-evaluation (HMR/SSR) re-creates a plugin's own id; return the existing
		// one rather than fail the route. Production and test keep the collision throw.
		if (devReplacesRegistration()) return name as PluginCommandId;
		throw new Error(
			`mintCommandId: "${name}" was already minted by ${priorOwner ? `plugin "${priorOwner}"` : 'another registration'}`
		);
	}
	mintedCommandIds.set(name, owner);
	return name as PluginCommandId;
}

export function isPluginCommandId(id: string): id is PluginCommandId {
	return mintedCommandIds.has(id);
}

export function __resetMintedCommandIdsForTests(): void {
	mintedCommandIds.clear();
}
