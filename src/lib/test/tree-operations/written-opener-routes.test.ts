// Every route that puts bytes into the tree gives an opener it puts on a line its own closer when a
// block below would close it otherwise, so the blocks below stay as they were.
// Miss-analysis (#800, #801): the closer lived in the content write and every row wrote through it,
// so no row drove a route that splices blocks (a drop, a split, a merge, a range delete, a move).
import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins } from '#lib';
import type { Document } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { latexPlugin } from '#lib/plugins/latex/index.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { detailsPlugin } from '#lib/plugins/details/index.js';
import { createReorderAction } from '#lib/editor-actions/reorder-action.js';
import { makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';
import { deleteRange } from '#lib/test/harness/range-delete.js';
import { fixtureGrammar } from '#lib/test/harness/fixture-grammar.js';
import { checkSplicedOpenersClosed } from '#lib/tree-operations/written-openers.js';

beforeEach(() => {
	installPlugins([latexPlugin(), admonitionsPlugin(), detailsPlugin()]);
});

/** Each opener, the block below it, the closer it gets, and a cut whose two halves open nothing. */
const OPENERS: Array<[opener: string, below: string, closer: string, cut: number]> = [
	['$$', '$$\nx\n$$\n', '$$', 1],
	[':::note', ':::tip\nbody\n:::\n', ':::', 3]
];

/** A route, given a document whose first blocks it rewrites so `opener` lands above `below`. */
type Route = (opener: string, below: string, cut: number) => Promise<string>;

const ROUTES: Array<[name: string, route: Route]> = [
	[
		'typed into a line',
		async (opener, below) => {
			const h = makeTopHarness(`x\n\n${below}`);
			await h.actions.updateBlockContent(0, `${opener}\n`, 'authored', 'join-typing', 1);
			return settled(h.deps.doc);
		}
	],
	[
		'a command rewriting the block',
		async (opener, below) => {
			const h = makeTopHarness(`x\n\n${below}`);
			await h.actions.replaceRaw(0, `${opener}\n`);
			return settled(h.deps.doc);
		}
	],
	[
		'replaced by blocks (a drop, a structural paste)',
		async (opener, below) => {
			const h = makeTopHarness(`x\n\n${below}`);
			const blocks = parse(`a\n\n${opener}\n`).children;
			await h.actions.replaceBlock(0, blocks, undefined, { snapshotOffset: 0 });
			return settled(h.deps.doc);
		}
	],
	[
		'split by Enter',
		async (opener, below) => {
			const h = makeTopHarness(`x${opener}\n\n${below}`);
			await h.actions.splitBlock(0, 1);
			return settled(h.deps.doc);
		}
	],
	[
		'joined by Backspace',
		async (opener, below, cut) => {
			const h = makeTopHarness(`${opener.slice(0, cut)}\n\n${opener.slice(cut)}\n\n${below}`);
			await h.actions.mergeWithPrevious(1);
			return settled(h.deps.doc);
		}
	],
	[
		'joined by a range delete',
		async (opener, below, cut) => {
			const head = `${opener.slice(0, cut)}!`;
			const doc = parse(`${head}\n\nmid\n\nz${opener.slice(cut)}\n\n${below}`);
			deleteRange(doc, { path: [0], offset: cut }, { path: [2], offset: 1 });
			return settled(doc);
		}
	],
	[
		'moved above it',
		async (opener, below) => {
			const h = makeTopHarness(`${below}\n${opener}\n`);
			await createReorderAction(h.deps, h.controller).moveReorderUnit([1], 0);
			return settled(h.deps.doc);
		}
	]
];

function settled(doc: Document): string {
	expectParseConverged(doc);
	return serialize(doc);
}

describe.each(ROUTES)('an opener %s', (_name, route) => {
	it.each(OPENERS)('`%s` takes in nothing below', async (opener, below, closer, cut) => {
		const out = await route(opener, below, cut);
		expect(out).toContain(`${opener}\n${closer}\n`);
		expect(out.endsWith(below)).toBe(true);
	});
});

// A fragment's opener need not be its last block: each waiting block is closed at its own end.
describe('a written fragment whose middle block waits', () => {
	it.each(OPENERS)('`%s` is closed where its block ends', async (opener, below, closer) => {
		const h = makeTopHarness(`x\n\n${below}`);
		await h.actions.replaceBlock(0, parse(`${opener}\n\nfoo\n`).children, undefined, {
			snapshotOffset: 0
		});
		expect(settled(h.deps.doc)).toBe(`${opener}\n${closer}\n\nfoo\n\n${below}`);
	});

	it('typed text closes it the same way', async () => {
		const h = makeTopHarness('x\n\n$$\nx\n$$\n');
		await h.actions.updateBlockContent(0, '$$\n\nfoo\n', 'authored', 'join-typing', 1);
		expect(settled(h.deps.doc)).toBe('$$\n$$\n\nfoo\n\n$$\nx\n$$\n');
	});
});

// G1.158 fails a route that splices an opener in without its closer.
describe('a spliced opener a block below would close', () => {
	it.each(OPENERS)('`%s` fails the check, and passes once closed', (opener, below, closer) => {
		const open = parse(`x\n\n${below}`);
		open.children[0] = parse(`${opener}\n`).children[0];
		expect(checkSplicedOpenersClosed(open, 0, 1, 'x\n', fixtureGrammar)?.code).toBe(
			'spliced-opener-closed'
		);

		const closed = parse(`${opener}\n${closer}\n\n${below}`);
		expect(checkSplicedOpenersClosed(closed, 0, 1, 'x\n', fixtureGrammar)).toBeNull();
	});

	it('an opener the splice only exposed is not asked', () => {
		const doc = parse('x\n```\n\n# Heading\n');
		doc.children.splice(1, 1, parse('```\n').children[0], parse('# Heading\n').children[0]);
		doc.children[2] = { ...doc.children[2], leadingTrivia: '\n' };
		expect(checkSplicedOpenersClosed(doc, 0, 2, '```js\nbody\n```\n', fixtureGrammar)).toBeNull();
	});
});
