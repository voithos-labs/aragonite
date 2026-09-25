/**
 * G4.68 and G4.69: every read the editor makes resolves through the editor's grammar, so a
 * plugin it left out, or a syntax it switched off, stays out (docs/design/plugin-contract.md
 * § Per-instance enablement). Internal readers take the grammar or the reading as a required
 * parameter; the scans below hold the parts a type cannot: who imports the published readers that
 * default it, and where the every-plugin fallback is spelled.
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
	stripComments,
	type SourceFile
} from './scan-source';
import { describeCallSiteRules, type CallSiteRule } from './call-site-rule';
import { notUnder } from './file-rule';

// ── G4.69 the defaulted readers stay at the edge ─────────────────────────────

/** The files that may import a reader whose grammar defaults to every installed plugin: the
 *  barrels publishing them, and the published code that runs with no editor. */
const DEFAULTED_READER_IMPORTERS: Record<string, string> = {
	'src/lib/index.ts': 'the public barrel publishes parse and parseInline',
	'src/lib/plugin.ts': 'the plugin barrel publishes parse and its no-editor computeInlineContent',
	'src/lib/plugins/admonitions/convert-document.ts':
		'a published whole-document conversion that runs with no editor',
	'src/lib/plugins/footnotes/footnote-numbering.ts':
		'the published numbering reads every plugin with no editor; a mounted widget passes its own reader',
	'src/lib/plugins/toc/heading-outline.ts':
		'the outline reads every plugin with no editor; the toc block passes its editor reader'
};
const mayImportDefaulted = (relPath: string): boolean =>
	relPath in DEFAULTED_READER_IMPORTERS || relPath.startsWith('src/lib/testing/');

/** Each defaulted reader a file imports from inside the library: `parse` and `parseInline` from
 *  anywhere in it, and the plugin barrel's `computeInlineContent`, which reads every plugin. */
function defaultedReaderImports(code: string): string[] {
	const found: string[] = [];
	const statement = /\b(?:import|export)\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
	for (const match of stripComments(code).matchAll(statement)) {
		const specifier = match[2];
		if (!specifier.startsWith('$lib') && !specifier.startsWith('.')) continue;
		for (const entry of match[1].split(',')) {
			const name = entry
				.trim()
				.replace(/^type\s+/, '')
				.split(/\s+as\s+/)[0];
			const fromPluginBarrel = /(^\$lib|\/|^\.)\/?plugin$/.test(specifier);
			if (name === 'parse' || name === 'parseInline') found.push(`${name} <- ${specifier}`);
			else if (name === 'computeInlineContent' && fromPluginBarrel) {
				found.push(`${name} <- ${specifier}`);
			}
		}
	}
	return found;
}

describe('G4.69 only the barrels, the kits and no-editor code import the defaulted readers', () => {
	const sources = collectEditorSources().filter((file) => file.relPath.startsWith('src/lib/'));

	it('finds none elsewhere in the library', () => {
		const offenders = sources
			.filter((file) => !mayImportDefaulted(file.relPath))
			.map((file) => ({ relPath: file.relPath, hits: defaultedReaderImports(file.code) }))
			.filter((file) => file.hits.length > 0);
		expect(
			offenders,
			'inside the editor, parse with `readBlocks` and read inline content with `readInline`: both take the grammar, so none reads every installed plugin (#266, #429)'
		).toEqual([]);
	});

	it('lists no file that no longer imports one', () => {
		const stale = Object.keys(DEFAULTED_READER_IMPORTERS).filter((relPath) => {
			const file = sources.find((f) => f.relPath === relPath);
			return !file || defaultedReaderImports(file.code).length === 0;
		});
		expect(stale).toEqual([]);
	});

	it('matches the defaulted readers by name and source', () => {
		expect(defaultedReaderImports("import { parse } from '../core/parser';")).toEqual([
			'parse <- ../core/parser'
		]);
		expect(
			defaultedReaderImports("import {\n\ttype X,\n\tparseInline as p\n} from '$lib/core/inline';")
		).toEqual(['parseInline <- $lib/core/inline']);
		expect(defaultedReaderImports("import { computeInlineContent } from '$lib/plugin';")).toEqual([
			'computeInlineContent <- $lib/plugin'
		]);
	});

	it('spares the internal readers, other names and other packages', () => {
		expect(
			defaultedReaderImports(
				"import { readBlocks, parseBlocks } from '../core/parser';\n" +
					"import { readInline, computeInlineContent } from './index';\n" +
					"import { parse } from 'yaml';\n" +
					"// import { parse } from '../core/parser';"
			)
		).toEqual([]);
	});
});

// ── G4.68 the every-plugin fallback ──────────────────────────────────────────

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

// Type pins: the inline cache, the render options and the action deps require the grammar, so a
// call leaving it out fails `npm run check` rather than reading every installed plugin.
// Miss-analysis: each typed the grammar optional, and the scan above sees only a fallback spelled
// out, never a caller that omits the field.
export function inlineCacheCallWithoutGrammar(node: NodeView, reading: Reading): void {
	// @ts-expect-error the reading carries the editor's grammar
	resolvedInlineContent(node, { resolver: reading.resolver });
	// @ts-expect-error no reading means no grammar
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
	withEnterCompletion(
		blockEdit,
		() => undefined,
		// @ts-expect-error the Enter completion reads the editor's grammar
		undefined,
		() => '\n'
	);
	// @ts-expect-error the action deps carry the editor's reading
	return deps;
}

// ── #443 the resolver a drawn tree was read with ─────────────────────────────

const REWRITE_PROBE = 'src/lib/components/blocks/text/probe.ts';

/** The writes that reparse a block the editor drew: the prose block's rewrites and auto-pair, and
 *  the bold and italic toggle. */
const DRAWN_TREE_REWRITES = (file: SourceFile): boolean =>
	file.relPath.startsWith('src/lib/components/blocks/text/') ||
	file.relPath === 'src/lib/core/inline/format-toggle.ts';

const RULES: CallSiteRule[] = [
	{
		id: 'G4.68 a live rewrite reparses with the link resolver its drawn tree was read with',
		population: DRAWN_TREE_REWRITES,
		calls: ['readInline'],
		holds: (args) => {
			const slot = callArguments(args)[3];
			return slot !== undefined && slot !== '' && slot !== 'undefined';
		},
		allowed: {},
		reason:
			'a reparse without the resolver reads every reference link as brackets, so a candidate compared with the drawn tree disagrees with it beside one (#443)',
		atLeastCallers: 9,
		hits: [{ relPath: REWRITE_PROBE, code: 'readInline(raw, 0, raw.length, undefined, grammar);' }],
		misses: [
			{
				relPath: REWRITE_PROBE,
				code:
					'readInline(raw, 0, raw.length, resolver, grammar);\n' +
					'readInline(raw, 0, raw.length, reading.resolver, reading.grammar);'
			}
		]
	}
];

describeCallSiteRules(RULES, collectEditorSources());
