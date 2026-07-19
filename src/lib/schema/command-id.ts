/**
 * Plugin command-id brand + mint. Mirrors the `PluginBlockKind` brand
 * (core/nodes) and the `declarePluginKind` collision guard: a minted id is a
 * plain branded string, so built-in `CommandId` switches stay exhaustive while
 * the block-command registry keys plugin ids. Register-once — throws on a name
 * that collides with a built-in id or a prior mint.
 */
import { GLOBAL_COMMAND_IDS, BLOCK_COMMAND_IDS, type CommandId } from './commands';
import { devReplacesRegistration } from './register-once';

declare const PluginCommandIdBrand: unique symbol;
export type PluginCommandId = string & { readonly [PluginCommandIdBrand]: true };

export type AnyCommandId = CommandId | PluginCommandId;

const NAME_PATTERN = /^[a-z][a-zA-Z0-9-]*(\.[a-z][a-zA-Z0-9-]*)*$/;

const BUILTIN_COMMAND_IDS = new Set<string>([...GLOBAL_COMMAND_IDS, ...BLOCK_COMMAND_IDS]);

// name → installing plugin at mint time (null when minted outside an install).
// The owner distinguishes a legitimate same-plugin re-mint from a cross-plugin
// collision.
const mintedCommandIds = new Map<string, string | null>();

/**
 * Mint (or resolve) a plugin command id. `owner` is the installing plugin — pass
 * `currentInstallingPlugin()`. The mint is name-global, but the block-command
 * registry key is composite `(kind, name)` and dispatch is kind-scoped, so a
 * plugin naming one command across several of its own kinds is coherent: the same
 * owner re-minting a name returns the existing brand. A DIFFERENT plugin (or an
 * unattributed re-mint) still throws, naming the prior owner.
 */
export function mintCommandId(name: string, owner: string | null = null): PluginCommandId {
	if (!NAME_PATTERN.test(name)) {
		throw new Error(
			`mintCommandId: invalid command name "${name}" — lowercase-first dot-separated segments of letters, digits, and hyphens`
		);
	}
	if (BUILTIN_COMMAND_IDS.has(name)) {
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
