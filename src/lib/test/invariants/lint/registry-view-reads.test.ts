/**
 * G4.68 and G4.69: every read of a registry a plugin can fill, and every reparse, resolves through
 * the editor's grammar, so a plugin the editor left out, or a syntax it switched off, stays out
 * of each route (docs/design/plugin-contract.md § Per-instance enablement).
 */

import { describe, expect, it } from 'vitest';
import type { BlockEditActions } from '$lib/action-contracts';
import type { InlineNode } from '$lib/core/nodes';
import { resolvedInlineContent } from '$lib/core/inline/inline-cache';
import { CONTENT_VISIBILITY, renderedText } from '$lib/core/inline/visibility';
import { renderInlineNodes } from '$lib/core/inline-render';
import type { NodeView } from '$lib/core/node-views';
import type { EditorActionsDeps } from '$lib/editor-actions/deps';
import { withEnterCompletion } from '$lib/editor-actions/enter-completion';
import type { Reading } from '$lib/schema/reading';
import {
	callArguments,
	collectEditorSources,
	enclosingFunction,
	lexicalClasses,
	type SourceFile
} from './scan-source';
import { describeCallSiteRules, type CallSiteRule } from './call-site-rule';
import { notUnder } from './file-rule';

/** The readers whose grammar is optional, and the argument position it takes (1-based). The
 *  checker cannot see a missing grammar there, so the call's text is read instead. The core
 *  `computeInlineContent` requires one, but the plugin barrel publishes the same name without. */
const OPTIONAL_GRAMMAR_POSITION: Record<string, number> = {
	parseInline: 5,
	computeInlineContent: 3,
	isVerticallyTransparentNode: 2
};

/** The readers whose grammar is a required parameter, alone or inside the link-resolver ref, so
 *  the checker refuses a call without one. */
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
	withEnterCompletion: 'src/lib/editor-actions/enter-completion.ts',
	keepsBlockKind: 'src/lib/components/blocks/text/edge-policy-dispatch.ts',
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
		it(`${name} declares its grammar, or a ref carrying it, with no default`, () => {
			const code = sources.find((file) => file.relPath === relPath)?.code ?? '';
			const parameters = declaredParameters(code, name);
			expect(parameters, `${relPath} declares no exported ${name}`).not.toBeNull();
			expect(parameters).toMatch(/\b(?:grammar: GrammarView|reading: Reading)\s*(,|$)/);
		});
	}
});

/** The places outside the parser, the grammar's own modules, the plugin barrel and the published
 *  kits that fall back to every installed plugin, each where an optional grammar arrives. */
const EVERY_PLUGIN_FALLBACKS: Record<string, string> = {
	'src/lib/core/inline/index.ts :: parseInline':
		'the published parseInline takes an optional grammar',
	'src/lib/core/inline/transparency.ts :: isVerticallyTransparentNode':
		'navigation reads transparency with no editor context',
	'src/lib/core/directive/activate.ts :: activateDirectiveGrammar':
		'the published recognizer type takes an optional grammar'
};

const FALLBACK_EXEMPT = notUnder(
	'src/lib/testing/',
	'src/lib/core/parser.ts',
	'src/lib/core/parsers/',
	'src/lib/schema/block-openers.ts',
	'src/lib/schema/registry-view.ts',
	'src/lib/plugin.ts'
);

/** Each `relPath :: function` that names `defaultGrammarView` outside an import. */
function fallbackSites(files: SourceFile[]): string[] {
	const found = new Set<string>();
	for (const file of files) {
		const code = file.code.replace(/^import[^;]*;/gm, (statement) => statement.replace(/\S/g, ' '));
		const classes = lexicalClasses(code);
		for (const match of code.matchAll(/\bdefaultGrammarView\b/g)) {
			found.add(`${file.relPath} :: ${enclosingFunction(code, match.index, classes)}`);
		}
	}
	return [...found];
}

const unlistedFallbacks = (found: string[]): string[] =>
	found.filter((key) => !(key in EVERY_PLUGIN_FALLBACKS));

describe('G4.68 the every-plugin fallback is spelled only in its listed places', () => {
	const found = fallbackSites(collectEditorSources().filter(FALLBACK_EXEMPT));

	it('names no fallback outside the list', () => {
		expect(unlistedFallbacks(found)).toEqual([]);
	});

	it('lists no place that no longer falls back', () => {
		expect(Object.keys(EVERY_PLUGIN_FALLBACKS).filter((key) => !found.includes(key))).toEqual([]);
	});
});

// Type pins: the resolver ref, the render options and the action deps require the grammar, so a
// call leaving it out fails `npm run check` rather than reading every installed plugin.
// Miss-analysis: each typed the grammar optional, and the scan above sees only a fallback spelled
// out, never a caller that omits the field.
export function inlineCacheCallWithoutGrammar(node: NodeView, ref: Reading): void {
	// @ts-expect-error the resolver ref carries the editor's grammar
	resolvedInlineContent(node, { current: ref.current, signature: ref.signature });
	// @ts-expect-error no ref means no grammar
	resolvedInlineContent(node);
}

export function renderCallWithoutGrammar(nodes: InlineNode[], raw: string): void {
	// @ts-expect-error the render options carry the editor's grammar
	renderInlineNodes(nodes, raw, {});
	// @ts-expect-error no options means no grammar
	renderInlineNodes(nodes, raw);
	// @ts-expect-error the visibility reads render through the same options
	renderedText(nodes, raw, CONTENT_VISIBILITY);
}

export function actionDepsWithoutGrammar(
	deps: Omit<EditorActionsDeps, 'reading'>,
	blockEdit: BlockEditActions
): EditorActionsDeps {
	// @ts-expect-error the Enter completion reads the editor's grammar
	withEnterCompletion(blockEdit, () => undefined, undefined);
	// @ts-expect-error the action deps carry the editor's reading
	return deps;
}

/** The published kits and the plugin API run outside any editor, so the whole process is theirs. */
const EDITOR_LESS = notUnder('src/lib/testing/', 'src/lib/core/parser.ts');

const REWRITE_PROBE = 'src/lib/components/blocks/text/probe.ts';

/** The writes that reparse a block the editor drew: the prose block's rewrites and auto-pair, and
 *  the bold and italic toggle. */
const DRAWN_TREE_REWRITES = (file: SourceFile): boolean =>
	file.relPath.startsWith('src/lib/components/blocks/text/') ||
	file.relPath === 'src/lib/core/inline/format-toggle.ts';

const RULES: CallSiteRule[] = [
	{
		id: 'G4.68 every plugin registry read outside its module passes the editor grammar',
		population: EDITOR_LESS,
		calls: Object.keys(OPTIONAL_GRAMMAR_POSITION),
		holds: threadsGrammar,
		// Each a known gap: the inline tree these sites read can hold a construct an unlisted plugin
		// claimed, which this editor draws as text.
		allowed: {
			'src/lib/core/inline/index.ts :: parseInline': 'an error message naming the call, not a call',
			'src/lib/editor-actions/container-block-component.ts :: isVerticallyTransparent':
				'the whole-block component deps carry no grammar; a container is transparent only if every child is',
			'src/lib/selection/keyboard-extend.ts :: isTransparent':
				'the vertical-extend path walks paths off the document with no editor context'
		},
		reason:
			'a read without the grammar resolves every installed plugin, so an unlisted plugin’s inline syntax, widget, directive name or completer reaches this editor (#266)',
		atLeastCallers: 10,
		hits: [
			'parseInline(raw, 0, raw.length);',
			'computeInlineContent(node, resolver, defaultGrammarView);',
			'isVerticallyTransparentNode(node, undefined);'
		],
		misses: [
			'parseInline(raw, 0, raw.length, undefined, grammar);\n' +
				'isVerticallyTransparentNode(node, deps.grammar);',
			'export function parseInline(raw, start, end, resolver, grammar) {}',
			'interface I { parseInline(raw: string, start?: number): X; }'
		]
	},
	{
		id: 'G4.68 a live rewrite reparses with the link resolver its drawn tree was read with',
		population: DRAWN_TREE_REWRITES,
		calls: ['parseInline'],
		holds: (args) => {
			const slot = callArguments(args)[3];
			return slot !== undefined && slot !== '' && slot !== 'undefined';
		},
		allowed: {},
		reason:
			'a reparse without the resolver reads every reference link as brackets, so a candidate compared with the drawn tree disagrees with it beside one (#443)',
		atLeastCallers: 9,
		hits: [
			{ relPath: REWRITE_PROBE, code: 'parseInline(raw, 0, raw.length, undefined, grammar);' }
		],
		misses: [
			{
				relPath: REWRITE_PROBE,
				code:
					'parseInline(raw, 0, raw.length, resolver, grammar);\n' +
					'parseInline(raw, 0, raw.length, ref?.current, ref?.grammar);'
			}
		]
	},
	{
		id: 'G4.69 every parse() call outside the parser reads the editor grammar',
		population: notUnder('src/lib/testing/', 'src/lib/core/parser.ts'),
		calls: ['parse'],
		holds: (args) => /\bgrammar\b/.test(args),
		allowed: {
			'src/lib/plugins/admonitions/convert-document.ts :: convertGithubAlertsInDocument':
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
