/**
 * Name-to-kind registry for the directive primitive: the shared opener resolves a fence's
 * `(tier, name)` here, then delegates to `fromDirective` or builds a lossless generic node.
 * Register-once with no unregister, the `customElements` model the schema registries follow.
 * Tier scopes the key, so a container and a leaf may share a name.
 */

import type { DirectiveTier, DirectiveFence } from './grammar';
import type { AnyBlockKind, PluginInlineKind, CstNode, InlineNode, Document } from '../nodes';
import { registerOnce } from '../../schema/register-once';

export interface ParsedDirective {
	fence: DirectiveFence;
	body?: Document;
	/** Passed through so a factory node serializes intact. */
	leadingTrivia: string;
	/** The exact consumed slice (opener + body + closer); a factory sets `node.raw` to this. */
	raw: string;
	closerColonCount: number;
	closerNewline: boolean;
	/** Opener line ending; a factory stores it so a rebuild reproduces CRLF chrome lines. */
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
	registerOnce(
		definitions.has(key),
		() => definitions.set(key, def),
		`registerDirective: "${key}" is already registered. Directives are register-once.`
	);
}

export function resolveDirective(
	tier: DirectiveTier,
	name: string
): DirectiveDefinition | undefined {
	return definitions.get(keyOf(tier, name));
}

/**
 * Pre-narrowed: the registration contract above guarantees a block node for these tiers, so the
 * union narrowing lives at this choke point instead of a cast per opener call site.
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

/**
 * What "does this kind have a recognizer" must ask: a directive kind owns no opener of its own,
 * so an opener-registry probe alone reads the whole directive tier as unrecognizable.
 */
export function isDirectiveKind(kind: AnyBlockKind | PluginInlineKind): boolean {
	for (const def of definitions.values()) {
		if (def.kind === kind) return true;
	}
	return false;
}

export function __resetDirectiveRegistryForTests(): void {
	definitions.clear();
}
