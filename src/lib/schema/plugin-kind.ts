import { BLOCK_KIND_TABLE, type PluginBlockKind } from '../core/nodes';

const NAME_PATTERN = /^[a-z][a-zA-Z0-9-]*$/;

const declaredPluginKinds = new Set<string>();

// Structural sentinels a plugin kind must not shadow. `document` is `Document.kind`
// (the CST root), not a BlockKind, so it escapes the BLOCK_KIND_TABLE check below.
const RESERVED_KIND_NAMES = new Set<string>(['document']);

export function declarePluginKind(name: string): PluginBlockKind {
	if (!NAME_PATTERN.test(name)) {
		throw new Error(
			`declarePluginKind: invalid kind name "${name}" — lowercase first letter, then letters/digits/hyphens`
		);
	}
	if (name in BLOCK_KIND_TABLE) {
		throw new Error(`declarePluginKind: "${name}" is a built-in BlockKind`);
	}
	if (RESERVED_KIND_NAMES.has(name)) {
		throw new Error(`declarePluginKind: "${name}" is a reserved structural sentinel`);
	}
	if (declaredPluginKinds.has(name)) {
		throw new Error(`declarePluginKind: "${name}" was already declared by another plugin`);
	}
	declaredPluginKinds.add(name);
	return name as PluginBlockKind;
}

export function __clearDeclaredPluginKindsForTests(): void {
	declaredPluginKinds.clear();
}
