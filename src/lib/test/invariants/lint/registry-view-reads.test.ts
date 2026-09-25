/**
 * G4.68 and G4.69: the published readers whose grammar is optional (`parse`, `parseInline`) are
 * called with the editor's grammar, and the every-plugin fallback is spelled only where no editor
 * exists. Every internal reader takes the grammar or the reading as a required parameter, which the
 * type checks (docs/design/plugin-contract.md § Per-instance enablement).
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
	computeInlineContent: 3
};

/** An explicit `defaultGrammarView` is the every-plugin reading spelled out, so it counts as none. */
const threadsGrammar = (args: string, callee: string): boolean => {
	const slot = callArguments(args)[OPTIONAL_GRAMMAR_POSITION[callee] - 1];
	return slot !== undefined && slot !== '' && slot !== 'undefined' && slot !== 'defaultGrammarView';
};

/** The places outside the parser, the grammar's own modules, the plugin barrel and the published
 *  kits that fall back to every installed plugin, each where an optional grammar arrives. */
const EVERY_PLUGIN_FALLBACKS: Record<string, string> = {
	'src/lib/core/inline/index.ts :: parseInline':
		'the published parseInline takes an optional grammar',
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
			'src/lib/core/inline/index.ts :: parseInline': 'an error message naming the call, not a call'
		},
		reason:
			'a read without the grammar resolves every installed plugin, so an unlisted plugin’s inline syntax, widget, directive name or completer reaches this editor (#266)',
		atLeastCallers: 10,
		hits: [
			'parseInline(raw, 0, raw.length);',
			'computeInlineContent(node, resolver, defaultGrammarView);'
		],
		misses: [
			'parseInline(raw, 0, raw.length, undefined, grammar);',
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
