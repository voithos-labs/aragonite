// The first-slot reader probes an item's marker line only when the written text starts with
// whitespace: the marker line reads every other text exactly as the item's body does.
// Miss-analysis: the reader's rows each named one shape, so nothing checked the claim the cheap
// read rests on across the block openers a first line can carry.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse, parseTaskItemBody, readBlocks } from '$lib/core/parser';
import { metadataOf, type CstNode } from '$lib/core/nodes';
import type { NodeView } from '$lib/core/node-views';
import { readThroughItemMarker } from '$lib/tree-operations/list/task-paragraph';
import { fixtureGrammar } from '../../harness/fixture-grammar';

const ITEMS = ['- a\n', '* a\n', '1. a\n', '10) a\n', '- [ ] a\n', '- [x] a\n'].map(
	(source) => parse(source).children[0].children![0]
);

/** Lines a first paragraph can hold, block openers and their near misses among them. */
const LINE = fc.constantFrom(
	'x',
	'two words',
	'# h',
	'#h',
	'> q',
	'- y',
	'* y',
	'+ y',
	'1. y',
	'2) y',
	'[ ] t',
	'[x] t',
	'```',
	'~~~ js',
	'---',
	'***',
	'- - -',
	'===',
	'| a |',
	'| - |',
	'<div>',
	'</div>',
	'<!-- c -->',
	'[a]: /u',
	'**b** `c`',
	'a\\',
	'',
	'  x',
	'    code',
	'\tcode',
	'   - y'
);

const TEXT = fc
	.array(LINE, { minLength: 1, maxLength: 6 })
	.map((lines) => lines.join('\n') + '\n')
	.filter((text) => !/^\s/.test(text));

const shape = (nodes: readonly CstNode[]) => nodes.map((n) => [n.kind, n.leadingTrivia, n.raw]);
const bytesOf = (nodes: readonly CstNode[]) => nodes.map((n) => n.leadingTrivia + n.raw).join('');

/** The marker line's reading as the write installs it, the spaces the marker took back on the
 *  first block; null where it moved other bytes (a tab's columns), which the write never installs. */
function asInstalled(read: CstNode[], bytes: string): CstNode[] | null {
	const kept = bytesOf(read);
	const lead = bytes.slice(0, bytes.length - kept.length);
	if (!bytes.endsWith(kept) || !/^[ \t]*$/.test(lead)) return null;
	return read.map((n, i) => (i === 0 ? { ...n, raw: lead + n.raw } : n));
}

/** What the item's body makes of `text` with no marker line in front of it. */
function bodyRead(item: NodeView, text: string): CstNode[] {
	return metadataOf(item, 'listItem').taskItem
		? parseTaskItemBody(text, fixtureGrammar).children
		: readBlocks(text, { grammar: fixtureGrammar, scope: 'fragment' }).children;
}

describe('the marker line reads text with no leading whitespace as the body does', () => {
	it('for every item kind and every mix of openers', () => {
		fc.assert(
			fc.property(fc.constantFrom(...ITEMS), TEXT, (item, text) => {
				const behind = readThroughItemMarker(item, text, fixtureGrammar)?.children;
				const body = bodyRead(item, text);
				const installed = behind && asInstalled(behind, bytesOf(body));
				if (installed) expect(shape(installed)).toEqual(shape(body));
			}),
			{ numRuns: 500 }
		);
	});
});
