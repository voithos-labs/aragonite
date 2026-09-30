// G1.41: the check fails each shape the commit's open-tail steps exist to prevent, and passes the
// documents they leave.
import { describe, it, expect } from 'vitest';
import type { Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { checkLastLineKept } from '$lib/invariants/open-tail';

/** `bytes` parsed, then the block at `path` stripped of its line ending, as a glue bug leaves it. */
function glued(bytes: string, path: number[]): Document {
	const doc = parse(bytes);
	let node = doc.children[path[0]];
	for (const index of path.slice(1)) node = node.children![index];
	node.raw = node.raw.replace(/\r?\n$/, '');
	return doc;
}

describe('G1.41 checkLastLineKept', () => {
	it.each([
		['an open document that gained a final break', parse('a\n\nb\n'), true, /gained/],
		['a closed document that lost its final break', parse('a\n\nb'), false, /lost/],
		['a line glued above the last one', glued('a\n\nb', [0]), true, /document > paragraph/],
		['a line glued above the last item', glued('- a\n- b', [0, 0]), true, /list > listItem/],
		// Miss-analysis: every container row ended on a child's line, so no walk had to stop at a
		// container's own last line and still check the children above it.
		[
			'a line glued two lines above a quote’s own `>` line',
			glued('> a\n>\n> b\n>\n', [0, 0]),
			false,
			/blockquote > paragraph/
		],
		[
			'a line glued onto a quote’s own `>` line',
			glued('> a\n>\n> b\n>\n', [0, 1]),
			false,
			/blockquote > paragraph/
		],
		[
			'a header row glued onto its delimiter line',
			glued('| h |\n| - |\n', [0, 0]),
			false,
			/table > tableRow/
		]
	])('fails %s', (_name, doc, wasOpen, message) => {
		expect(checkLastLineKept(doc, wasOpen)?.message).toMatch(message);
	});

	it.each([
		['an open document that stayed open', 'a\n\nb', true],
		['a closed document that stayed closed', 'a\n\nb\n', false],
		['an open document that now ends in a blank block', 'a\n\n\n', true],
		['an open document that now ends in a trailing blank line', 'a\n\n', true],
		['an open document that now ends in an empty line inside a quote', '> a\n>\n>\n', true],
		['a closed document ending in a quote’s own `>` line', '> a\n>\n> b\n>\n', false],
		['an open document ending in a header-only table', '| h |\n| - |', true],
		['an emptied document', '', true]
	])('passes %s', (_name, bytes, wasOpen) => {
		expect(checkLastLineKept(parse(bytes), wasOpen)).toBeNull();
	});
});
