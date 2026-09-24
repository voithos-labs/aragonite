/**
 * G4.68 and G4.69: every read of a registry a plugin can fill, and every reparse, resolves through
 * the editor's grammar, so a plugin the editor left out, or a syntax it switched off, stays out
 * of each route (docs/design/plugin-contract.md § Per-instance enablement).
 */

import { callArguments, collectEditorSources } from './scan-source';
import { describeCallSiteRules, type CallSiteRule } from './call-site-rule';
import { notUnder } from './file-rule';

/** Each reader, and the argument position its grammar takes (1-based). */
const GRAMMAR_POSITION: Record<string, number> = {
	scanInline: 5,
	parseInline: 5,
	computeInlineContent: 3,
	getInlineContent: 4,
	isInlineWidget: 3,
	getInlineWidgetEditing: 2,
	getInlineWidgetComponent: 2,
	isCharacterLikeWidget: 2,
	flattenInlineWidgets: 3,
	buildCoreInlineWidget: 4,
	isAutoPairTrigger: 2,
	resolveDirective: 3,
	resolveBlockDirectiveFactory: 3,
	completeTypedLine: 2,
	completeLineOnType: 2,
	planEnterCompletion: 3,
	planTypedCompletion: 3,
	isVerticallyTransparentNode: 2,
	widgetAtCursor: 5,
	findWidgetNodeByStart: 4,
	findFirstEdgeWidget: 3,
	findLastEdgeWidget: 3,
	resolveDelimiterAutoPair: 6,
	keepsBlockKind: 3
};

const threadsGrammar = (args: string, callee: string): boolean => {
	const slot = callArguments(args)[GRAMMAR_POSITION[callee] - 1];
	return slot !== undefined && slot !== '' && slot !== 'undefined';
};

/** The published kits and the plugin API run outside any editor, so the whole process is theirs. */
const EDITOR_LESS = notUnder('src/lib/testing/', 'src/lib/core/parser.ts');

const RULES: CallSiteRule[] = [
	{
		id: 'G4.68 every plugin registry read outside its module passes the editor grammar',
		population: EDITOR_LESS,
		calls: Object.keys(GRAMMAR_POSITION),
		holds: threadsGrammar,
		// Sites with no grammar in reach, each a known gap: the inline tree they read can hold a
		// construct an unlisted plugin claimed, which this editor draws as text.
		allowed: {
			'src/lib/core/inline/index.ts:100': 'an error message naming the call, not a call',
			'src/lib/components/blocks/text/construct-edge-delete.ts:257':
				'the edge delete surface carries no link context, so no grammar either',
			'src/lib/components/blocks/text/edge-seat.ts:216':
				'a pure byte helper reached from the seat resolver, three calls below any grammar',
			'src/lib/components/blocks/text/link-source-bytes.ts:91':
				'the link card passes the resolver alone, two modules above this check',
			'src/lib/components/blocks/text/link-source-bytes.ts:135':
				'the link card passes the resolver alone, two modules above this check',
			'src/lib/components/blocks/text/link-source-bytes.ts:212':
				'the link card passes the resolver alone, two modules above this check',
			'src/lib/components/blocks/text/pending-mark-insert.ts:196':
				'the pending-mark candidate check takes no link context, like its resolver',
			'src/lib/components/blocks/text/pending-mark-insert.ts:225':
				'the pending-mark candidate check takes no link context, like its resolver',
			'src/lib/editor-actions/container-block-component.ts:286':
				'the whole-block component deps carry no grammar; a container is transparent only if every child is',
			'src/lib/selection/keyboard-extend.ts:334':
				'the vertical-extend path walks paths off the document with no editor context',
			'src/lib/plugins/footnotes/footnote-numbering.ts:42':
				'the published computeInlineContent takes no grammar: the plugin API exposes none',
			'src/lib/plugins/toc/heading-outline.ts:68':
				'the published computeInlineContent takes no grammar: the plugin API exposes none'
		},
		reason:
			'a read without the grammar resolves every installed plugin, so an unlisted plugin’s inline syntax, widget, directive name or completer reaches this editor (#266)',
		atLeastCallers: 10,
		hits: [
			'parseInline(raw, 0, raw.length);',
			'isInlineWidget(node, raw, undefined);',
			'completeTypedLine(line);'
		],
		misses: [
			'parseInline(raw, 0, raw.length, undefined, grammar);\n' +
				'getInlineWidgetEditing(kind, deps.linkRef?.grammar);',
			'export function isInlineWidget(node, raw, grammar) {}'
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
