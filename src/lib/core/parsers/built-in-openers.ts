/**
 * Registers the built-in block openers. Lives beside the matchers because
 * schema/block-kind-descriptor.ts importing them would cycle (parsers/* import
 * parser.ts, which reads the opener registry). Called explicitly from core/parser.ts:
 * a bare side-effect import is tree-shaken out of the production build.
 */

import { registerBlockOpener } from '../../schema/block-openers';
import { OPENER_PRIORITIES } from '../../schema/opener-priorities';
import { matchFenceOpen, parseFencedCode } from './fenced-code';
import { matchHeading } from './heading';
import { matchThematicBreak } from './thematic-break';
import { matchBlockquote, parseBlockquote } from './blockquote';
import { matchListItem, parseList, canInterruptParagraph as listCanInterrupt } from './list';
import { matchIndentedCode, parseIndentedCode } from './indented-code';
import {
	matchHtmlBlock,
	parseHtmlBlock,
	canInterruptParagraph as htmlCanInterrupt
} from './html-block';
import { parseLinkReferenceDefinition } from './link-reference';

// Idempotence guard, not a registry bypass: a dev-server re-eval resets it so
// the register-once dev valve still replaces.
let registered = false;

export function registerBuiltInOpeners(): void {
	if (registered) return;
	registered = true;

	registerBlockOpener('fencedCode', {
		priority: OPENER_PRIORITIES.fencedCode,
		tryOpen(ctx) {
			const fence = matchFenceOpen(ctx.line.text);
			if (!fence) return null;
			return parseFencedCode(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia, fence);
		},
		interruptsParagraph: (t) => matchFenceOpen(t) !== null
	});

	registerBlockOpener('heading', {
		priority: OPENER_PRIORITIES.heading,
		tryOpen(ctx) {
			const heading = matchHeading(ctx.line.text);
			if (!heading) return null;
			return {
				node: {
					kind: 'heading',
					leadingTrivia: ctx.leadingTrivia,
					raw: ctx.line.raw,
					metadata: { level: heading.level }
				},
				consumed: 1
			};
		},
		interruptsParagraph: (t) => matchHeading(t) !== null
	});

	// Setext heading's `---` underline is disambiguated inside parseParagraph;
	// at dispatch a bare thematic line can't be an underline (no open paragraph).
	registerBlockOpener('thematicBreak', {
		priority: OPENER_PRIORITIES.thematicBreak,
		tryOpen(ctx) {
			const marker = matchThematicBreak(ctx.line.text);
			if (!marker) return null;
			return {
				node: {
					kind: 'thematicBreak',
					leadingTrivia: ctx.leadingTrivia,
					raw: ctx.line.raw,
					metadata: { marker }
				},
				consumed: 1
			};
		},
		// `---` is ambiguous with a setext L2 underline, which has first claim.
		interruptsParagraph: (t) => {
			const marker = matchThematicBreak(t);
			return marker === '*' || marker === '_';
		}
	});

	registerBlockOpener('blockquote', {
		priority: OPENER_PRIORITIES.blockquote,
		tryOpen(ctx) {
			if (!matchBlockquote(ctx.line.text)) return null;
			return parseBlockquote(
				ctx.lines,
				ctx.index,
				ctx.end,
				ctx.leadingTrivia,
				ctx.depth,
				ctx.isDocumentParse
			);
		},
		interruptsParagraph: matchBlockquote
	});

	registerBlockOpener('list', {
		priority: OPENER_PRIORITIES.list,
		tryOpen(ctx) {
			if (!matchListItem(ctx.line.text)) return null;
			return parseList(
				ctx.lines,
				ctx.index,
				ctx.end,
				ctx.leadingTrivia,
				ctx.depth,
				ctx.isDocumentParse
			);
		},
		interruptsParagraph: listCanInterrupt
	});

	registerBlockOpener('indentedCode', {
		priority: OPENER_PRIORITIES.indentedCode,
		tryOpen(ctx) {
			if (!matchIndentedCode(ctx.line.text)) return null;
			return parseIndentedCode(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
		},
		// GFM §4.4: indented code cannot interrupt a paragraph. An open paragraph absorbs the
		// indented line lazily, so this opener only sees lines with no paragraph open.
		interruptsParagraph: false
	});

	registerBlockOpener('htmlBlock', {
		priority: OPENER_PRIORITIES.htmlBlock,
		tryOpen(ctx) {
			const type = matchHtmlBlock(ctx.line.text);
			if (type === null) return null;
			return parseHtmlBlock(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia, type);
		},
		interruptsParagraph: htmlCanInterrupt
	});

	registerBlockOpener('linkReferenceDefinition', {
		priority: OPENER_PRIORITIES.linkReferenceDefinition,
		tryOpen(ctx) {
			return parseLinkReferenceDefinition(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
		},
		interruptsParagraph: false
	});
}
