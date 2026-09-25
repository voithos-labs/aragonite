/**
 * Name-to-kind registry for the directive syntax: the shared opener resolves a fence's
 * `(tier, name)` (tier: container, leaf or text) here, then delegates to `fromDirective` or
 * builds a lossless generic node.
 * Register-once with no unregister, the `customElements` model the schema registries follow.
 * Tier scopes the key, so a container and a leaf may share a name.
 */

import type { DirectiveTier, DirectiveFence } from './grammar';
import type { AnyBlockKind, PluginInlineKind, CstNode, InlineNode, Document } from '../nodes';
import type { GrammarView } from '../../schema/block-openers';
import { createPluginRegistry } from '../../schema/plugin-registry';

export interface ParsedDirective {
	fence: DirectiveFence;
	body?: Document;
	/** Passed through so a factory node serializes intact. */
	leadingTrivia: string;
	/** The exact consumed slice (opener + body + closer); a factory sets `node.raw` to this. */
	raw: string;
	closerColonCount: number;
	closerNewline: boolean;
	/** Opener line ending; a factory stores it so a rebuild keeps CRLF fence lines. */
	lineEnding: string;
}

export interface DirectiveDefinition {
	kind: AnyBlockKind | PluginInlineKind;
	/** Omit to let the opener build a generic lossless node. */
	fromDirective?(parsed: ParsedDirective): CstNode | InlineNode;
}

const definitions = createPluginRegistry<string, DirectiveDefinition>({
	label: 'registerDirective',
	isBuiltin: () => false
});

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
	definitions.register(
		key,
		def,
		`registerDirective: "${key}" is already registered. Directives are register-once.`
	);
}

/** The name's definition under an editor's grammar; a name its plugin registered is absent where
 *  the editor left that plugin out, so the fence reads as the generic directive. */
export function resolveDirective(
	tier: DirectiveTier,
	name: string,
	grammar: GrammarView
): DirectiveDefinition | undefined {
	return definitions.get(keyOf(tier, name), grammar.activation);
}

/**
 * Pre-narrowed: registration guarantees a block node for these tiers, so the union narrowing
 * happens here once instead of a cast per opener call site.
 */
export function resolveBlockDirectiveFactory(
	tier: 'leaf' | 'container',
	name: string,
	grammar: GrammarView
): ((parsed: ParsedDirective) => CstNode) | undefined {
	const factory = resolveDirective(tier, name, grammar)?.fromDirective;
	return factory as ((parsed: ParsedDirective) => CstNode) | undefined;
}

export function isDirectiveRegistered(tier: DirectiveTier, name: string): boolean {
	return definitions.has(keyOf(tier, name));
}

/**
 * What "does this kind have a recognizer" must ask: a directive kind owns no opener of its own,
 * so checking the opener registry alone reads every directive kind as unrecognizable.
 */
export function isDirectiveKind(kind: AnyBlockKind | PluginInlineKind): boolean {
	return definitions.records().some(({ value }) => value.kind === kind);
}
