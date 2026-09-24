/**
 * G4.68 and G4.69: every read of a registry a plugin can fill, and every reparse, resolves through
 * the editor's grammar, so a plugin the editor left out, or a syntax it switched off, stays out
 * of each route (docs/design/plugin-contract.md § Per-instance enablement).
 */

import { describe, expect, it } from 'vitest';
import { callArguments, collectEditorSources } from './scan-source';
import { describeCallSiteRules, type CallSiteRule } from './call-site-rule';
import { notUnder } from './file-rule';

/** The readers whose grammar is optional, and the argument position it takes (1-based). The
 *  checker cannot see a missing grammar there, so the call's text is read instead. The core
 *  `computeInlineContent` requires one, but the plugin barrel publishes the same name without. */
const OPTIONAL_GRAMMAR_POSITION: Record<string, number> = {
	parseInline: 5,
	computeInlineContent: 3,
	isVerticallyTransparentNode: 2,
	keepsBlockKind: 3,
	soleProseReparse: 2
};

/** The readers whose grammar is a required parameter, so the checker refuses a call without one. */
const REQUIRED_GRAMMAR_READERS: Record<string, string> = {
	scanInline: 'src/lib/core/inline/scan/index.ts',
	computeInlineContent: 'src/lib/core/inline/index.ts',
	getInlineContent: 'src/lib/core/inline/inline-cache.ts',
	isInlineWidget: 'src/lib/core/inline/inline-widgets.ts',
	getInlineWidgetEditing: 'src/lib/core/inline/inline-widgets.ts',
	getInlineWidgetComponent: 'src/lib/core/inline/inline-widgets.ts',
	isCharacterLikeWidget: 'src/lib/core/inline/inline-widgets.ts',
	flattenInlineWidgets: 'src/lib/core/inline/inline-widgets.ts',
	buildCoreInlineWidget: 'src/lib/core/inline/inline-widgets.ts',
	isAutoPairTrigger: 'src/lib/core/inline/scan/plugin-syntax.ts',
	resolveDirective: 'src/lib/core/directive/registry.ts',
	resolveBlockDirectiveFactory: 'src/lib/core/directive/registry.ts',
	completeTypedLine: 'src/lib/schema/block-completions.ts',
	completeLineOnType: 'src/lib/schema/block-completions.ts',
	planEnterCompletion: 'src/lib/editor-actions/enter-completion.ts',
	planTypedCompletion: 'src/lib/editor-actions/enter-completion.ts',
	widgetAtCursor: 'src/lib/components/blocks/text/widget-adjacency.ts',
	findWidgetNodeByStart: 'src/lib/components/blocks/text/widget-adjacency.ts',
	findFirstEdgeWidget: 'src/lib/components/blocks/text/widget-adjacency.ts',
	findLastEdgeWidget: 'src/lib/components/blocks/text/widget-adjacency.ts',
	resolveDelimiterAutoPair: 'src/lib/components/blocks/text/delimiter-autopair.ts',
	stepsOverRevealedCloser: 'src/lib/components/blocks/text/delimiter-autopair.ts',
	resolveEmptyPairBackspace: 'src/lib/components/blocks/text/delimiter-autopair.ts',
	resolveMarkedInsertion: 'src/lib/components/blocks/text/pending-mark-insert.ts',
	resolveEdgeSeat: 'src/lib/components/blocks/text/edge-seat.ts',
	relocateComposedRun: 'src/lib/components/blocks/text/edge-seat.ts'
};

/** An explicit `defaultGrammarView` is the every-plugin reading spelled out, so it counts as none. */
const threadsGrammar = (args: string, callee: string): boolean => {
	const slot = callArguments(args)[OPTIONAL_GRAMMAR_POSITION[callee] - 1];
	return slot !== undefined && slot !== '' && slot !== 'undefined' && slot !== 'defaultGrammarView';
};

/** The parameter list of `name`'s exported declaration in `code`, or null when none is found. */
function declaredParameters(code: string, name: string): string | null {
	const match = new RegExp(`export function ${name}\\(([^]*?)\\):`).exec(code);
	return match ? match[1] : null;
}

describe('G4.68 the internal registry readers take the grammar as a required parameter', () => {
	const sources = collectEditorSources();
	for (const [name, relPath] of Object.entries(REQUIRED_GRAMMAR_READERS)) {
		it(`${name} declares \`grammar: GrammarView\` with no default`, () => {
			const code = sources.find((file) => file.relPath === relPath)?.code ?? '';
			const parameters = declaredParameters(code, name);
			expect(parameters, `${relPath} declares no exported ${name}`).not.toBeNull();
			expect(parameters).toMatch(/\bgrammar: GrammarView\s*(,|$)/);
		});
	}
});

/** The places outside the parser, the grammar's own modules, the plugin barrel and the published
 *  kits that fall back to every installed plugin, each where an optional grammar arrives. */
const EVERY_PLUGIN_FALLBACKS: Record<string, string> = {
	'src/lib/core/inline/index.ts:104': 'the published parseInline takes an optional grammar',
	'src/lib/core/inline/inline-cache.ts:67': 'the action deps carry the link context optionally',
	'src/lib/core/inline/transparency.ts:15': 'navigation reads transparency with no editor context',
	'src/lib/core/inline-render.ts:414': 'the render options reach renderedText with no grammar',
	'src/lib/editor-actions/enter-completion.ts:36': 'the action deps carry the grammar optionally',
	'src/lib/core/directive/activate.ts:33': 'the published recognizer type takes an optional grammar'
};

const FALLBACK_EXEMPT = notUnder(
	'src/lib/testing/',
	'src/lib/core/parser.ts',
	'src/lib/core/parsers/',
	'src/lib/schema/block-openers.ts',
	'src/lib/schema/registry-view.ts',
	'src/lib/plugin.ts'
);

describe('G4.68 the every-plugin fallback is spelled only in its listed places', () => {
	const found: string[] = [];
	for (const file of collectEditorSources().filter(FALLBACK_EXEMPT)) {
		const code = file.code.replace(/^import[^;]*;/gm, (statement) => statement.replace(/\S/g, ' '));
		code.split('\n').forEach((line, index) => {
			if (/\bdefaultGrammarView\b/.test(line)) found.push(`${file.relPath}:${index + 1}`);
		});
	}

	it('names no fallback outside the list', () => {
		expect(found.filter((key) => !(key in EVERY_PLUGIN_FALLBACKS))).toEqual([]);
	});

	it('lists no place that no longer falls back', () => {
		expect(Object.keys(EVERY_PLUGIN_FALLBACKS).filter((key) => !found.includes(key))).toEqual([]);
	});
});

/** The published kits and the plugin API run outside any editor, so the whole process is theirs. */
const EDITOR_LESS = notUnder('src/lib/testing/', 'src/lib/core/parser.ts');

const RULES: CallSiteRule[] = [
	{
		id: 'G4.68 every plugin registry read outside its module passes the editor grammar',
		population: EDITOR_LESS,
		calls: Object.keys(OPTIONAL_GRAMMAR_POSITION),
		holds: threadsGrammar,
		// Each a known gap: the inline tree these sites read can hold a construct an unlisted plugin
		// claimed, which this editor draws as text.
		allowed: {
			'src/lib/core/inline/index.ts:101': 'an error message naming the call, not a call',
			'src/lib/editor-actions/container-block-component.ts:286':
				'the whole-block component deps carry no grammar; a container is transparent only if every child is',
			'src/lib/selection/keyboard-extend.ts:334':
				'the vertical-extend path walks paths off the document with no editor context',
			'src/lib/plugins/footnotes/footnote-numbering.ts:42':
				'the published computeInlineContent takes no grammar: the plugin API exposes none (#433)',
			'src/lib/plugins/toc/heading-outline.ts:68':
				'the published computeInlineContent takes no grammar: the plugin API exposes none (#433)'
		},
		reason:
			'a read without the grammar resolves every installed plugin, so an unlisted plugin’s inline syntax, widget, directive name or completer reaches this editor (#266)',
		atLeastCallers: 10,
		hits: [
			'parseInline(raw, 0, raw.length);',
			'computeInlineContent(node, resolver, defaultGrammarView);',
			'keepsBlockKind(node, line, undefined);'
		],
		misses: [
			'parseInline(raw, 0, raw.length, undefined, grammar);\n' +
				'keepsBlockKind(node, line, deps.grammar);',
			'export function parseInline(raw, start, end, resolver, grammar) {}'
		]
	},
	{
		id: 'G4.69 every parse() call outside the parser reads the editor grammar',
		population: notUnder('src/lib/testing/', 'src/lib/core/parser.ts'),
		calls: ['parse'],
		holds: (args) => /\bgrammar\b/.test(args),
		allowed: {
			'src/lib/plugins/admonitions/convert-document.ts:11':
				'a published whole-document conversion that runs with no editor'
		},
		reason:
			'a reparse without the grammar reads a switched-off syntax or an unlisted plugin’s opener, so an edit makes a kind a reload of the same bytes would not (#429)',
		atLeastCallers: 10,
		hits: ["parse(raw, { scope: 'fragment' });"],
		misses: [
			"parse(raw, { grammar, scope: 'fragment' });\nparse(raw, { grammar: view.grammar });",
			'parseInline(raw); JSON.parse(raw); doc.parse(raw);'
		]
	}
];

describeCallSiteRules(RULES, collectEditorSources());
