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
	/** The opener's `ctx.leadingTrivia`, passed through so a factory node serializes intact. */
	leadingTrivia: string;
	/** The exact consumed byte slice (opener line + body + closer) — a factory sets `node.raw` to this. */
	raw: string;
	closerColonCount: number;
	closerNewline: boolean;
	/** Authored line ending (`\n` or `\r\n`) of the opener line — a factory stores it so a rebuild reproduces CRLF chrome lines. */
	lineEnding: string;
}

export interface DirectiveDefinition {
	kind: AnyBlockKind | PluginInlineKind;
	/** Omit to let the opener build a generic lossless node. */
	fromDirective?(parsed: ParsedDirective): CstNode | InlineNode;
}

const definitions = new Map<string, DirectiveDefinition>();

const keyOf = (tier: DirectiveTier, name: string): string => `${tier}:${name}`;

export function registerDirective(
	tier: DirectiveTier,
	name: string,
	def: DirectiveDefinition
): void {
	// Fail loud at registration so a tier/factory mismatch can't silently no-op at dispatch.
	if (tier === 'container' && !def.fromDirective) {
		throw new Error(
			`registerDirective: container "${name}" requires a fromDirective factory ` +
				`(a kind-only container would orphan the generic rebuild path).`
		);
	}
	if (tier === 'text' && def.fromDirective) {
		throw new Error(
			`registerDirective: text "${name}" is kind-only; fromDirective is not used for inline nodes.`
		);
	}

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

/**
 * Block-tier factory, pre-narrowed: a 'leaf'/'container' factory constructs a
 * block node by the registration contract above, so the union narrowing lives
 * here at the registry choke point instead of a cast per opener call site.
 */
export function resolveBlockDirectiveFactory(
	tier: 'leaf' | 'container',
	name: string
): ((parsed: ParsedDirective) => CstNode) | undefined {
	const factory = definitions.get(keyOf(tier, name))?.fromDirective;
	return factory as ((parsed: ParsedDirective) => CstNode) | undefined;
}

export function isDirectiveRegistered(tier: DirectiveTier, name: string): boolean {
	return definitions.has(keyOf(tier, name));
}

export function __resetDirectiveRegistryForTests(): void {
	definitions.clear();
}
