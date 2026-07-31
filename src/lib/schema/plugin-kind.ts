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

// Structural sentinels a plugin kind must not shadow. `document` is `Document.kind`, not a
// BlockKind, so it escapes the BLOCK_KIND_TABLE check below.
const RESERVED_KIND_NAMES = new Set<string>(['document']);

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
		// Dev re-eval (HMR/SSR) re-declares a plugin's own kind; return the existing
		// brand rather than 500 the route. Production/test keep the collision throw.
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
 * Recover the branded kind for an already-declared name, so a module that didn't mint it reaches
 * the brand without an unchecked cast. Throws for an undeclared name, so a typo can't silently
 * register against a kind that doesn't exist.
 */
export function declaredPluginKind(name: string): PluginBlockKind {
	if (!declaredPluginKinds.has(name)) {
		throw new Error(
			`declaredPluginKind: "${name}" has not been declared — call declarePluginKind first`
		);
	}
	return name as PluginBlockKind;
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
		// Dev re-eval survival — see declarePluginKind. Production/test keep the throw.
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

/**
 * The inline mirror of {@link isBlockKindRegistered}, so a plugin re-declaring idempotently
 * guards on this instead of catching {@link declaredPluginInlineKind}'s throw.
 */
export function isInlineKindDeclared(name: string): boolean {
	return declaredPluginInlineKinds.has(name);
}

export function __clearDeclaredPluginInlineKindsForTests(): void {
	declaredPluginInlineKinds.clear();
}
