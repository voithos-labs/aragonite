import {
	BLOCK_KIND_TABLE,
	isBuiltinInlineKind,
	type AnyInlineKind,
	type PluginBlockKind,
	type PluginInlineKind
} from '../core/nodes';
import { currentInstallingPlugin, pluginKindOwner, recordPluginKindOwner } from './plugin-install';
import { isValidPluginName } from './plugin-name';
import { devReplacesRegistration } from './register-once';

const declaredPluginKinds = new Set<string>();

// Names a plugin kind must not take: `document` is `Document.kind` and `global` is the
// keybinding-override scope, so neither appears in `BLOCK_KIND_TABLE`.
const RESERVED_KIND_NAMES = new Set<string>(['document', 'global']);

export function declarePluginKind(name: string): PluginBlockKind {
	if (!isValidPluginName(name)) {
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
		// Hot reload and SSR re-declare a plugin's own kind: hand back the branded name rather
		// than break the route. Production and test keep the throw.
		if (devReplacesRegistration()) return name as PluginBlockKind;
		const owner = pluginKindOwner(name);
		throw new Error(
			`declarePluginKind: "${name}" was already declared by another plugin` +
				(owner ? ` — first declared by plugin '${owner}'` : '')
		);
	}
	declaredPluginKinds.add(name);
	const installer = currentInstallingPlugin();
	if (installer) recordPluginKindOwner(name, installer);
	return name as PluginBlockKind;
}

/**
 * The branded kind for a name already declared, so a module that did not declare it gets the
 * branded type without an unchecked cast. Throws for an undeclared name, so a typo cannot quietly
 * register against a kind that does not exist.
 */
export function declaredPluginKind(name: string): PluginBlockKind {
	if (!declaredPluginKinds.has(name)) {
		throw new Error(
			`declaredPluginKind: "${name}" has not been declared — call declarePluginKind first`
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

export function __clearDeclaredPluginKindsForTests(): void {
	declaredPluginKinds.clear();
}

const declaredPluginInlineKinds = new Set<string>();

export function declarePluginInlineKind(name: string): PluginInlineKind {
	if (!isValidPluginName(name)) {
		throw new Error(
			`declarePluginInlineKind: invalid kind name "${name}" — lowercase first letter, then letters/digits/hyphens`
		);
	}
	if (isBuiltinInlineKind(name as AnyInlineKind)) {
		throw new Error(`declarePluginInlineKind: "${name}" is a built-in InlineNodeKind`);
	}
	if (declaredPluginInlineKinds.has(name)) {
		// Hot reload and SSR re-declare: see `declarePluginKind`. Production and test keep the throw.
		if (devReplacesRegistration()) return name as PluginInlineKind;
		throw new Error(`declarePluginInlineKind: "${name}" was already declared by another plugin`);
	}
	declaredPluginInlineKinds.add(name);
	return name as PluginInlineKind;
}

/** The inline mirror of {@link declaredPluginKind}; throws for an undeclared name. */
export function declaredPluginInlineKind(name: string): PluginInlineKind {
	if (!declaredPluginInlineKinds.has(name)) {
		throw new Error(
			`declaredPluginInlineKind: "${name}" has not been declared — call declarePluginInlineKind first`
		);
	}
	return name as PluginInlineKind;
}

/** The inline mirror of {@link isBlockKindDeclared}. */
export function isInlineKindDeclared(name: string): boolean {
	return declaredPluginInlineKinds.has(name);
}

export function __clearDeclaredPluginInlineKindsForTests(): void {
	declaredPluginInlineKinds.clear();
}
