/**
 * Registers the built-in block openers. Lives beside the matcher
 * implementations (schema/block-kind-descriptor.ts cannot import them —
 * parsers/* import parser.ts, which reads the opener registry, so the
 * import would cycle). Imported for side effect by core/parser.ts, so
 * every parse() entry point sees the built-ins registered.
 */

import { registerBlockOpener } from '../../schema/block-openers';
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
	priority: 10,
	tryOpen(ctx) {
		const fence = matchFenceOpen(ctx.line.text);
		if (!fence) return null;
		return parseFencedCode(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia, fence);
	},
	interruptsParagraph: (t) => matchFenceOpen(t) !== null
});

registerBlockOpener('heading', {
	priority: 20,
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
	priority: 30,
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
	priority: 40,
	tryOpen(ctx) {
		if (!matchBlockquote(ctx.line.text)) return null;
		return parseBlockquote(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
	},
	interruptsParagraph: matchBlockquote
});

registerBlockOpener('list', {
	priority: 50,
	tryOpen(ctx) {
		if (!matchListItem(ctx.line.text)) return null;
		return parseList(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
	},
	interruptsParagraph: listCanInterrupt
});

registerBlockOpener('indentedCode', {
	priority: 60,
	tryOpen(ctx) {
		if (!matchIndentedCode(ctx.line.text)) return null;
		// GFM §4.4: indented code cannot interrupt a paragraph — opens only
		// after a blank line or at the window start.
		if (ctx.leadingTrivia.length === 0 && !ctx.isFirstInWindow) return null;
		return parseIndentedCode(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
	},
	interruptsParagraph: false
});

registerBlockOpener('htmlBlock', {
	priority: 70,
	tryOpen(ctx) {
		if (matchHtmlBlock(ctx.line.text) === null) return null;
		return parseHtmlBlock(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
	},
	interruptsParagraph: htmlCanInterrupt
});

registerBlockOpener('linkReferenceDefinition', {
	priority: 80,
	tryOpen(ctx) {
		return parseLinkReferenceDefinition(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
	},
	interruptsParagraph: false
});

// register-once now throws on duplicate; full-reload on edit instead of re-running these.
import.meta.hot?.accept(() => import.meta.hot?.invalidate());
