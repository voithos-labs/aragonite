/**
 * Declaring the names plugin kinds take, block and inline, and which plugin declared each: a
 * kind's owner is the plugin whose setup declared it, and it decides where the kind resolves.
 */
import {
	BLOCK_KIND_TABLE,
	isBuiltinInlineKind,
	type AnyInlineKind,
	type PluginBlockKind,
	type PluginInlineKind
} from '../core/nodes';
import type { EditorContext } from './plugin-install';
import { isValidPluginName } from './plugin-name';
import { createPluginRegistry } from './plugin-registry';

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

/** This editor's `EditorContext` for the plugin that owns `kind`. Passing `''` when no plugin owns
 *  it returns the editor's base context, so leaf blocks and containers resolve the same way. */
export function owningPluginEditor(
	pluginEditor: ((pluginName: string) => EditorContext | undefined) | undefined,
	kind: string
): EditorContext | undefined {
	return pluginEditor?.(pluginKindOwner(kind) ?? '');
}

/**
 * The branded kind for a name already declared, so a module that did not declare it gets the
 * branded type without an unchecked cast. Throws for an undeclared name, so a typo cannot quietly
 * register against a kind that does not exist.
 */
export function declaredPluginKind(name: string): PluginBlockKind {
	if (!declaredPluginKinds.has(name)) {
		throw new Error(
			`declaredPluginKind: "${name}" has not been declared; call declarePluginKind first`
		);
	}
	return name as PluginBlockKind;
}

/**
 * Has this name been declared? A module that may run twice (hot reload, a re-imported
 * registration) asks first instead of catching {@link declarePluginKind}'s or
 * {@link declaredPluginKind}'s throw.
 */
export function isBlockKindDeclared(name: string): boolean {
	return declaredPluginKinds.has(name);
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

/** The inline mirror of {@link isBlockKindDeclared}. */
export function isInlineKindDeclared(name: string): boolean {
	return declaredPluginInlineKinds.has(name);
}
