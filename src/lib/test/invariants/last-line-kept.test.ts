// G1.41: the check fails each shape the commit's last-line steps exist to prevent, and passes the
// documents they leave.
import { describe, it, expect, beforeEach } from 'vitest';
import type { Document } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { checkLastLineKept, lastLineOf, type LastLine } from '#lib/invariants/open-tail.js';
import { activateDirectiveGrammar } from '#lib/core/directive/activate.js';
import { rebuildContainerRaw } from '#lib/schema/container-raw.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { testDirectiveViews } from '#lib/test/harness/test-view.js';

/** `bytes` parsed, then the block at `path` stripped of its line ending, as a glue bug leaves it. */
function glued(bytes: string, path: number[]): Document {
	const doc = parse(bytes);
	let node = doc.children[path[0]];
	for (const index of path.slice(1)) node = node.children![index];
	node.raw = node.raw.replace(/\r?\n$/, '');
	return doc;
}

describe('G1.41 checkLastLineKept', () => {
	it.each<[string, Document, LastLine, RegExp]>([
		['an open document that gained a final break', parse('a\n\nb\n'), 'open', /gained/],
		['a closed document that lost its final break', parse('a\n\nb'), 'closed', /lost/],
		// Miss-analysis: "open" was read off the last block alone, so a document ending in an unended
		// blank line held in its suffix counted as ended.
		['a closed document left ending on an unended blank line', parse('a\n '), 'closed', /lost/],
		['a line glued above the last one', glued('a\n\nb', [0]), 'open', /document > paragraph/],
		['a line glued above the last item', glued('- a\n- b', [0, 0]), 'open', /list > listItem/],
		// Miss-analysis: every container row ended on a child's line, so no walk had to stop at a
		// container's own last line and still check the children above it.
		[
			'a line glued two lines above a quote’s own `>` line',
			glued('> a\n>\n> b\n>\n', [0, 0]),
			'closed',
			/blockquote > paragraph/
		],
		[
			'a line glued onto a quote’s own `>` line',
			glued('> a\n>\n> b\n>\n', [0, 1]),
			'closed',
			/blockquote > paragraph/
		],
		[
			'a header row glued onto its delimiter line',
			glued('| h |\n| - |\n', [0, 0]),
			'closed',
			/table > tableRow/
		]
	])('fails %s', (_name, doc, before, message) => {
		expect(checkLastLineKept(doc, before)?.message).toMatch(message);
	});

	it.each<[string, string, LastLine]>([
		['an open document that stayed open', 'a\n\nb', 'open'],
		['a closed document that stayed closed', 'a\n\nb\n', 'closed'],
		['an open document that now ends in a blank block', 'a\n\n\n', 'open'],
		['an open document that now ends in a trailing blank line', 'a\n\n', 'open'],
		['an open document that now ends in an empty line inside a quote', '> a\n>\n>\n', 'open'],
		['a closed document ending in a quote’s own `>` line', '> a\n>\n> b\n>\n', 'closed'],
		['an open document ending in a header-only table', '| h |\n| - |', 'open'],
		['an emptied document', '', 'open'],
		// Miss-analysis: an emptied document was read as ending in a line break, so the letter typed
		// into it next read as that break lost.
		['a letter typed into an emptied document', 'x', 'none'],
		['a line pasted into an emptied document', 'x\n', 'none']
	])('passes %s', (_name, bytes, before) => {
		expect(checkLastLineKept(parse(bytes), before)).toBeNull();
	});

	it.each<[string, LastLine]>([
		['', 'none'],
		['a', 'open'],
		['a\n', 'closed'],
		['a\r\n', 'closed'],
		['a\n ', 'open'],
		['- a\n- b', 'open']
	])('reads the last line of %j as %s', (bytes, expected) => {
		expect(lastLineOf(parse(bytes))).toBe(expected);
	});
});

// Miss-analysis: the walk read line children only in strips and grids, so the body line above an
// opaque container's own closing line went unchecked, and the rebuild glued the closer onto it.
describe('G1.41 over a container with its own closing line', () => {
	beforeEach(() => activateDirectiveGrammar(testDirectiveViews()));

	it('fails a body line glued onto a directive’s closing `:::`', () => {
		const doc = glued('intro\n\n:::note\nbody\n:::\n', [1, 1]);
		expect(checkLastLineKept(doc, 'closed')?.message).toMatch(/directiveContainer > paragraph/);
	});

	it('fails the directive the rebuild then writes, whose closer lost its line', () => {
		const doc = glued('intro\n\n:::note\nbody\n:::\n', [1, 1]);
		rebuildContainerRaw(doc.children[1], defaultGrammarView);
		expect(doc.children[1].raw).toBe(':::note\nbody:::\n');
		expect(checkLastLineKept(doc, 'closed')?.message).toMatch(/directiveContainer > paragraph/);
	});

	it('passes an open document ending in a directive’s closing line', () => {
		expect(checkLastLineKept(parse('intro\n\n:::note\nbody\n:::'), 'open')).toBeNull();
	});
});
