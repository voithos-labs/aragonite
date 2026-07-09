/**
 * Name→kind registry for the directive primitive: the shared opener resolves a
 * fence's `(tier, name)` to a definition here, then either delegates to its
 * `fromDirective` factory or builds a lossless generic node. Register-once,
 * throw-on-duplicate, no unregister — the `customElements` model the schema
 * registries follow. Tier scopes the key, so a container and a leaf may share a
 * name without colliding.
 */

import type { DirectiveTier, DirectiveFence } from './grammar';
import type { AnyBlockKind, PluginInlineKind, CstNode, InlineNode, Document } from '../nodes';

export interface ParsedDirective {
	fence: DirectiveFence;
	body?: Document;
}

export interface DirectiveDefinition {
	kind: AnyBlockKind | PluginInlineKind;
	/** Omit to let the opener build a generic lossless node (a later dispatch). */
	fromDirective?(parsed: ParsedDirective): CstNode | InlineNode;
}

const definitions = new Map<string, DirectiveDefinition>();

const keyOf = (tier: DirectiveTier, name: string): string => `${tier}:${name}`;

export function registerDirective(
	tier: DirectiveTier,
	name: string,
	def: DirectiveDefinition
): void {
	const key = keyOf(tier, name);
	if (definitions.has(key)) {
		throw new Error(
			`registerDirective: "${key}" is already registered. Directives are register-once.`
		);
	}
	definitions.set(key, def);
}

export function resolveDirective(
	tier: DirectiveTier,
	name: string
): DirectiveDefinition | undefined {
	return definitions.get(keyOf(tier, name));
}

export function isDirectiveRegistered(tier: DirectiveTier, name: string): boolean {
	return definitions.has(keyOf(tier, name));
}

export function __resetDirectiveRegistryForTests(): void {
	definitions.clear();
}
