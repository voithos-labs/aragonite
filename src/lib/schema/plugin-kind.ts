/**
 * Declaring the names plugin kinds take, block and inline, and which plugin declared each: a
 * kind's owner is the plugin whose setup declared it, and it decides where the kind resolves.
 * The registries keyed by a kind are built here, since they answer to that owner.
 */
import {
	BLOCK_KIND_TABLE,
	isBuiltinInlineKind,
	type AnyBlockKind,
	type AnyInlineKind,
	type PluginBlockKind,
	type PluginInlineKind
} from '../core/nodes';
import { isValidPluginName } from './plugin-name';
import {
	buildRegistry,
	createPluginRegistry,
	type KindRegistry,
	type PluginRegistryOptions
} from './plugin-registry';

const declaredPluginKinds = createPluginRegistry<string, true>({
	label: 'declarePluginKind',
	isBuiltin: () => false
});

// Names a plugin kind must not take: `document` is `Document.kind` and `global` is the
// keybinding-override scope, so neither appears in `BLOCK_KIND_TABLE`.
const RESERVED_KIND_NAMES = new Set<string>(['document', 'global']);

export function declarePluginKind(name: string): PluginBlockKind {
	if (!isValidPluginName(name)) {
		throw new Error(
			`declarePluginKind: invalid kind name "${name}"; lowercase first letter, then letters/digits/hyphens`
		);
	}
	if (name in BLOCK_KIND_TABLE) {
		throw new Error(`declarePluginKind: "${name}" is a built-in BlockKind`);
	}
	if (RESERVED_KIND_NAMES.has(name)) {
		throw new Error(`declarePluginKind: "${name}" is a reserved structural sentinel`);
	}
	const owner = declaredPluginKinds.ownerOf(name);
	declaredPluginKinds.register(
		name,
		true,
		`declarePluginKind: "${name}" was already declared by another plugin` +
			(owner ? ` — first declared by plugin '${owner}'` : '')
	);
	return name as PluginBlockKind;
}

/** The plugin whose setup declared `kind`; null for a built-in or a kind declared outside one. */
export function pluginKindOwner(kind: string): string | null {
	return declaredPluginKinds.ownerOf(kind);
}

/** Every block kind the setup of plugin `owner` declared, in declaration order. */
export function pluginKindsDeclaredBy(owner: string): PluginBlockKind[] {
	return declaredPluginKinds
		.records()
		.filter((record) => record.owner === owner)
		.map((record) => record.key as PluginBlockKind);
}

/**
 * The branded kind for a declared name, without an unchecked cast. Throws for an undeclared name,
 * so a typo cannot quietly register against a kind that does not exist.
 */
export function declaredPluginKind(name: string): PluginBlockKind {
	if (!declaredPluginKinds.has(name)) {
		throw new Error(
			`declaredPluginKind: "${name}" has not been declared; call declarePluginKind first`
		);
	}
	return name as PluginBlockKind;
}

const declaredPluginInlineKinds = createPluginRegistry<string, true>({
	label: 'declarePluginInlineKind',
	isBuiltin: () => false
});

export function declarePluginInlineKind(name: string): PluginInlineKind {
	if (!isValidPluginName(name)) {
		throw new Error(
			`declarePluginInlineKind: invalid kind name "${name}"; lowercase first letter, then letters/digits/hyphens`
		);
	}
	if (isBuiltinInlineKind(name as AnyInlineKind)) {
		throw new Error(`declarePluginInlineKind: "${name}" is a built-in InlineNodeKind`);
	}
	declaredPluginInlineKinds.register(
		name,
		true,
		`declarePluginInlineKind: "${name}" was already declared by another plugin`
	);
	return name as PluginInlineKind;
}

/** The inline mirror of {@link declaredPluginKind}; throws for an undeclared name. */
export function declaredPluginInlineKind(name: string): PluginInlineKind {
	if (!declaredPluginInlineKinds.has(name)) {
		throw new Error(
			`declaredPluginInlineKind: "${name}" has not been declared; call declarePluginInlineKind first`
		);
	}
	return name as PluginInlineKind;
}

/** The inline mirror of {@link pluginKindOwner}. */
export function pluginInlineKindOwner(kind: string): string | null {
	return declaredPluginInlineKinds.ownerOf(kind);
}

/** The inline mirror of {@link pluginKindsDeclaredBy}. */
export function pluginInlineKindsDeclaredBy(owner: string): PluginInlineKind[] {
	return declaredPluginInlineKinds
		.records()
		.filter((record) => record.owner === owner)
		.map((record) => record.key as PluginInlineKind);
}

/** Whether an inline kind name is declared, for the editor's own checks. */
export function isInlineKindDeclared(name: string): boolean {
	return declaredPluginInlineKinds.has(name);
}

// ── Registries keyed by a kind ───────────────────────────────────────────────

export function createBlockKindRegistry<V>(
	options: PluginRegistryOptions<AnyBlockKind>
): KindRegistry<AnyBlockKind, V> {
	return buildRegistry<AnyBlockKind, V>(
		options,
		(key, registrant) => pluginKindOwner(key) ?? registrant
	);
}

export function createInlineKindRegistry<V>(
	options: PluginRegistryOptions<AnyInlineKind>
): KindRegistry<AnyInlineKind, V> {
	return buildRegistry<AnyInlineKind, V>(
		options,
		(key, registrant) => pluginInlineKindOwner(key) ?? registrant
	);
}
