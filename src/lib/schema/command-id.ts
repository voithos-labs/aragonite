/**
 * Plugin command-id brand + mint, mirroring the `PluginBlockKind` brand (core/nodes): a minted
 * id is a plain branded string, so built-in `CommandId` switches stay exhaustive while the
 * block-command registry keys plugin ids. Register-once.
 */
import { isBuiltinCommandId, type CommandId } from './commands';
import { devReplacesRegistration } from './register-once';

declare const PluginCommandIdBrand: unique symbol;
export type PluginCommandId = string & { readonly [PluginCommandIdBrand]: true };

export type AnyCommandId = CommandId | PluginCommandId;

const NAME_PATTERN = /^[a-z][a-zA-Z0-9-]*(\.[a-z][a-zA-Z0-9-]*)*$/;

// name → installing plugin at mint time (null when minted outside an install). The owner
// distinguishes a legitimate same-plugin re-mint from a cross-plugin collision.
const mintedCommandIds = new Map<string, string | null>();

/**
 * Mint (or resolve) a plugin command id; `owner` is the installing plugin. The mint is
 * name-global but dispatch is kind-scoped, so the same owner re-minting a name returns the
 * existing brand; a different plugin (or an unattributed re-mint) throws, naming the prior owner.
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
		// Dev re-eval (HMR/SSR) re-mints a plugin's own id; return the existing brand
		// rather than 500 the route. Production/test keep the collision throw.
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
