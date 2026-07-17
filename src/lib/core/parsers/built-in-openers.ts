/**
 * Registers the built-in block openers. Lives beside the matcher
 * implementations (schema/block-kind-descriptor.ts cannot import them —
 * parsers/* import parser.ts, which reads the opener registry, so the
 * import would cycle). Imported for side effect by core/parser.ts, so
 * every parse() entry point sees the built-ins registered.
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
			nextIndex: ctx.index + 1
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
			nextIndex: ctx.index + 1
		};
	},
	// `---` is ambiguous with a setext L2 underline — the setext branch has
	// first claim, so only `*`/`_` breaks interrupt a paragraph.
	interruptsParagraph: (t) => {
		const marker = matchThematicBreak(t);
		return marker === '*' || marker === '_';
	}
});

registerBlockOpener('blockquote', {
	priority: OPENER_PRIORITIES.blockquote,
	tryOpen(ctx) {
		if (!matchBlockquote(ctx.line.text)) return null;
		return parseBlockquote(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
	},
	interruptsParagraph: matchBlockquote
});

registerBlockOpener('list', {
	priority: OPENER_PRIORITIES.list,
	tryOpen(ctx) {
		if (!matchListItem(ctx.line.text)) return null;
		return parseList(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
	},
	interruptsParagraph: listCanInterrupt
});

registerBlockOpener('indentedCode', {
	priority: OPENER_PRIORITIES.indentedCode,
	tryOpen(ctx) {
		if (!matchIndentedCode(ctx.line.text)) return null;
		return parseIndentedCode(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
	},
	// GFM §4.4: indented code cannot interrupt a paragraph. An open paragraph
	// already absorbs a following indented line as lazy continuation, so the
	// line only reaches this opener when no paragraph is open — where indented
	// code opens with no blank line required.
	interruptsParagraph: false
});

registerBlockOpener('htmlBlock', {
	priority: OPENER_PRIORITIES.htmlBlock,
	tryOpen(ctx) {
		if (matchHtmlBlock(ctx.line.text) === null) return null;
		return parseHtmlBlock(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
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
