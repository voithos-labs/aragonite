// @vitest-environment jsdom
//
// Miss-analysis: the directive and completer suites ran with every installed plugin active, and
// admonitions' setup attributed the shared `:::` kinds to itself, so no test parsed a fence or
// pressed Enter in an editor that left the owning plugin out (GH #266).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { declarePluginInlineKind, declarePluginKind } from '$lib/schema/plugin-kind';
import { registerDirective } from '$lib/core/directive/registry';
import { DIRECTIVE_CONTAINER, DIRECTIVE_TEXT } from '$lib/core/directive/kinds';
import { registerBlockCompleter } from '$lib/schema/block-completions';
import { planEnterCompletion } from '$lib/editor-actions/enter-completion';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { parse } from '$lib/core/parser';
import { parseInline } from '$lib/core/inline';
import { defaultGrammarView, type GrammarView } from '$lib/schema/block-openers';
import type { CstNode } from '$lib/core/nodes';
import { grammarListing } from './grammar-listing';

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
	resetPluginPlatformForTests();
	installPlugins([admonitionsPlugin(), unlisted]);
});
afterEach(resetPluginPlatformForTests);

const NOTE = ':::note\n\nbody\n\n:::\n';
const noteKind = (grammar: GrammarView) => parse(NOTE, { grammar }).children[0].kind;
const TEXT_DIRECTIVE = 'press :kbd[Ctrl]';
const textDirectiveKinds = (grammar: GrammarView) =>
	parseInline(TEXT_DIRECTIVE, 0, TEXT_DIRECTIVE.length, undefined, grammar).map((n) => n.kind);
const completes = (grammar: GrammarView) =>
	planEnterCompletion(
		{ kind: 'paragraph', leadingTrivia: '', raw: '%%%\n' } as CstNode,
		3,
		grammar
	);

describe('an unlisted directive name resolves to the generic directive', () => {
	it('parses a `:::note` fence as the generic container where admonitions is left out', () => {
		expect(noteKind(grammarListing(['unlisted']))).toBe(DIRECTIVE_CONTAINER);
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
