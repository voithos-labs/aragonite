import { BLOCK_KIND_TABLE, type PluginBlockKind } from '../core/nodes';

const NAME_PATTERN = /^[a-z][a-zA-Z0-9-]*$/;

/**
 * Brand a plugin block-kind name. The single creation point, so future
 * registration rules (e.g. duplicate-kind conflicts) have one place to enforce.
 */
export function declarePluginKind(name: string): PluginBlockKind {
	if (!NAME_PATTERN.test(name)) {
		throw new Error(
			`declarePluginKind: invalid kind name "${name}" — lowercase first letter, then letters/digits/hyphens`
		);
	}
	if (name in BLOCK_KIND_TABLE) {
		throw new Error(`declarePluginKind: "${name}" is a built-in BlockKind`);
	}
	return name as PluginBlockKind;
}
