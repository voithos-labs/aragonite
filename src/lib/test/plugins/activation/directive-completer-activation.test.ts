// Miss-analysis: no test parsed a fence or pressed Enter with the owning plugin left out (GH #266).
import { beforeEach, describe, expect, it } from 'vitest';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import {
	declarePluginInlineKind,
	declarePluginKind,
	declaredPluginKind
} from '#lib/schema/plugin-kind.js';
import { registerDirective } from '#lib/core/directive/registry.js';
import { DIRECTIVE_CONTAINER, DIRECTIVE_TEXT } from '#lib/core/directive/kinds.js';
import { registerBlockCompleter } from '#lib/schema/block-completions.js';
import { planEnterCompletion } from '#lib/editor-actions/enter-completion.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { parse } from '#lib/core/parser.js';
import { parseInline } from '#lib/core/inline/index.js';
import { defaultGrammarView, type GrammarView } from '#lib/schema/block-openers.js';
import type { CstNode } from '#lib/core/nodes.js';
import { grammarListing } from './grammar-listing';
import { createRegistryView } from '#lib/schema/registry-view.js';
import { activationFor } from '#lib/schema/plugin-activation.js';

const unlisted = definePlugin({
	name: 'unlisted',
	setup() {
		registerDirective('text', 'kbd', { kind: declarePluginInlineKind('kbd-key') });
		registerBlockCompleter(declarePluginKind('rule-box'), {
			tryComplete: (line) =>
				line === '%%%' ? { lines: ['%%%', 'x'], caret: { path: [], line: 1, column: 0 } } : null
		});
	}
});

beforeEach(() => {
	installPlugins([admonitionsPlugin(), unlisted]);
});

const NOTE = ':::note\n\nbody\n\n:::\n';
const noteKind = (grammar: GrammarView) => parse(NOTE, { grammar }).children[0].kind;
const TEXT_DIRECTIVE = 'press :kbd[Ctrl]';
const textDirectiveKinds = (grammar: GrammarView) =>
	parseInline(TEXT_DIRECTIVE, 0, TEXT_DIRECTIVE.length, undefined, grammar).map((n) => n.kind);
const completes = (grammar: GrammarView) =>
	planEnterCompletion(
		{ kind: 'paragraph', leadingTrivia: '', raw: '%%%\n' } as CstNode,
		3,
		grammar,
		'\n'
	);

describe('an unlisted directive name resolves to the generic directive', () => {
	it('parses a `:::note` fence as the generic container where admonitions is left out', () => {
		expect(noteKind(grammarListing(['unlisted']))).toBe(DIRECTIVE_CONTAINER);
	});

	// Miss-analysis: no case asked for the generic kinds' component with admonitions left out.
	it('draws the generic container with its own component where admonitions is left out', () => {
		const view = createRegistryView({ plugins: activationFor(['unlisted']) });
		expect(view.component(declaredPluginKind(DIRECTIVE_CONTAINER))).toBeDefined();
	});

	it('parses it as an admonition where every installed plugin is active', () => {
		expect(noteKind(defaultGrammarView)).toBe('admonition');
	});

	it('reads an unlisted text directive name as the generic text directive', () => {
		expect(textDirectiveKinds(grammarListing(['admonitions']))).toContain(DIRECTIVE_TEXT);
		expect(textDirectiveKinds(defaultGrammarView)).toContain('kbd-key');
	});
});

describe("an unlisted plugin's completer never fires on Enter", () => {
	it('declines where the plugin is left out', () => {
		expect(completes(grammarListing(['admonitions']))).toBeNull();
	});

	it('completes where every installed plugin is active', () => {
		expect(completes(defaultGrammarView)).not.toBeNull();
	});
});
