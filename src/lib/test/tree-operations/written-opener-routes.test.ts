// Every route that puts bytes into the tree gives an opener it puts on a line its own closer when a
// block below would close it otherwise, so the blocks below stay as they were.
// Miss-analysis (#800, #801): the closer lived in the content write and every row wrote through it,
// so no row drove a route that splices blocks (a drop, a split, a merge, a range delete, a move).
// Miss-analysis: no row wrote through the byte splice, the commit a draft and the range edits use.
import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins } from '#lib';
import type { Document } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { latexPlugin } from '#packages/latex/src/index.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { detailsPlugin } from '#packages/details/src/index.js';
import { createReorderAction } from '#lib/editor-actions/reorder-action.js';
import { makeTopHarness, type TopHarness } from '#lib/test/harness/editor-actions.js';
import { draftRegistryOver } from '#lib/test/harness/drafts.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';
import { deleteRange } from '#lib/test/harness/range-delete.js';
import { fixtureGrammar } from '#lib/test/harness/fixture-grammar.js';
import { checkSplicedOpenersClosed } from '#lib/tree-operations/written-openers.js';
import { checkSplicedChangesClosed } from '#lib/tree-operations/spliced-openers.js';
import { spliceReading } from '#lib/tree-operations/byte-splice.js';

beforeEach(() => {
	installPlugins([latexPlugin(), admonitionsPlugin(), detailsPlugin()]);
});

/** Each opener, the block below it, the closer it gets, and a cut whose two halves open nothing. */
const OPENERS: Array<[opener: string, below: string, closer: string, cut: number]> = [
	['$$', '$$\nx\n$$\n', '$$', 1],
	[':::note', ':::tip\nbody\n:::\n', ':::', 3],
	['```', '```\nx\n```\n', '```', 1]
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
	],
	[
		'written by a draft',
		async (opener, below) => {
			const h = makeTopHarness(`x\n\n${below}`);
			const draft = draftRegistryOver(h).edit().replace({ from: 0, to: 1 }, opener);
			expect(await draft.commit()).toEqual({ ok: true });
			return settled(h.deps.doc);
		}
	],
	[
		'spliced in as bytes',
		async (opener, below) => {
			const h = makeTopHarness(`x\n\n${below}`);
			await spliced(h, 0, 1, opener);
			return settled(h.deps.doc);
		}
	],
	[
		'joined by a byte removal',
		async (opener, below, cut) => {
			const between = '!\n\nmid\n\nz';
			const h = makeTopHarness(`${opener.slice(0, cut)}${between}${opener.slice(cut)}\n\n${below}`);
			await spliced(h, cut, cut + between.length, '');
			return settled(h.deps.doc);
		}
	]
];

function settled(doc: Document): string {
	expectParseConverged(doc);
	return serialize(doc);
}

/** `insert` over bytes `[from, to)` of the harness's document through the byte splice. */
async function spliced(h: TopHarness, from: number, to: number, insert: string): Promise<void> {
	const wrote = await h.controller.commitSource({
		changes: [{ from, to, insert }],
		caret: { at: from + insert.length, holds: 'text' },
		op: { kind: 'replaceBlock', detail: { source: 'draft' } },
		snapshot: { path: docPathFrom([0]), offset: 0 }
	});
	expect(wrote).toBe(true);
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
	// An open code fence takes in the rest of its fragment, so it is never a middle block.
	const middle = OPENERS.filter(([opener]) => opener !== '```');
	it.each(middle)('`%s` is closed where its block ends', async (opener, below, closer) => {
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

/** The routes that hand the byte splice document bytes, writing `insert` over `[from, to)`. */
const SPLICE_ROUTES: Array<
	[name: string, write: (h: TopHarness, from: number, to: number, insert: string) => Promise<void>]
> = [
	[
		'written by a draft',
		async (h, from, to, insert) => {
			const draft = draftRegistryOver(h).edit().replace({ from, to }, insert);
			expect(await draft.commit()).toEqual({ ok: true });
		}
	],
	['spliced in as bytes', spliced]
];

/** A container, its first line's marker and the marker each line after it takes. */
const CONTAINERS: Array<[name: string, first: string, rest: string, blank: string]> = [
	['a quote', '> ', '> ', '>'],
	['a list item', '- ', '  ', '']
];

/** `text`'s lines inside the container. */
function inside(text: string, [, first, rest, blank]: (typeof CONTAINERS)[number]): string {
	return text
		.split('\n')
		.slice(0, -1)
		.map((line, i) => (i === 0 ? first : line === '' ? blank : rest) + line + '\n')
		.join('');
}

describe.each(SPLICE_ROUTES)('an opener %s inside a container', (_name, write) => {
	describe.each(CONTAINERS)('%s', (...container) => {
		it.each(OPENERS)('`%s` takes in nothing below', async (opener, below, closer) => {
			const h = makeTopHarness(inside(`x\n\n${below}`, container));
			await write(h, container[1].length, container[1].length + 1, opener);
			expect(settled(h.deps.doc)).toBe(inside(`${opener}\n${closer}\n\n${below}`, container));
		});
	});
});

// A fenced container rebuilds its own opening and closing lines around the closer it gets.
describe.each(SPLICE_ROUTES)('an opener %s inside a fenced container', (_name, write) => {
	const DETAILS = '<details>\n<summary>S</summary>\n\n';
	it.each([
		['an admonition', ':::tip\nx\n\n$$\ny\n$$\n:::\n', ':::tip\n$$\n$$\n\n$$\ny\n$$\n:::\n'],
		[
			'a details block',
			`${DETAILS}x\n\n$$\ny\n$$\n\n</details>\n`,
			`${DETAILS}$$\n$$\n\n$$\ny\n$$\n\n</details>\n`
		]
	])('in %s, `$$` takes in nothing below', async (_, source, after) => {
		const h = makeTopHarness(source);
		const at = source.indexOf('x\n');
		await write(h, at, at + 1, '$$');
		expect(settled(h.deps.doc)).toBe(after);
	});
});

// The range edits write bytes their in-block write already closed, so the splice adds nothing to them.
describe('bytes that carry their closer already', () => {
	it.each(OPENERS)(
		'`%s` gets no second closer from the byte splice',
		async (opener, below, closer) => {
			const h = makeTopHarness(`x\n\n${below}`);
			await spliced(h, 0, 1, `${opener}\n${closer}`);
			expect(settled(h.deps.doc)).toBe(`${opener}\n${closer}\n\n${below}`);
		}
	);
});

// A removal counts only the line it joins as written, so an opener whose closer it took reads on.
describe('a removal that takes a closing line', () => {
	const source = ':::note\nx\n:::\n\npara\n\n:::tip\ny\n:::\n';
	const removed = { from: source.indexOf('\n:::'), to: source.indexOf('\n:::') + 4 };
	const left = ':::note\nx\n\npara\n\n:::tip\ny\n:::\n';

	it('adds no closer through the byte splice, as the range delete adds none', async () => {
		const h = makeTopHarness(source);
		await spliced(h, removed.from, removed.to, '');
		expect(settled(h.deps.doc)).toBe(left);

		const deleted = parse(source);
		deleteRange(deleted, { path: [0], offset: removed.from }, { path: [0], offset: removed.to });
		expect(settled(deleted)).toBe(left);
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

	// The byte splice asks it of its changes before it reads them, at the depth each one sits.
	it.each(CONTAINERS.flatMap((c) => OPENERS.map((o) => [c[0], ...o] as const)))(
		'in %s, `%s` written by a byte splice fails the check, and passes once closed',
		(where, opener, below, closer) => {
			const container = CONTAINERS.find(([name]) => name === where)!;
			const doc = parse(inside(`x\n\n${below}`, container));
			const before = serialize(doc);
			const at = container[1].length;
			const check = (insert: string) => {
				const changes = [{ from: at, to: at + 1, insert }];
				const reading = spliceReading(doc, before, changes, fixtureGrammar)!;
				return checkSplicedChangesClosed(doc, before, changes, reading, fixtureGrammar);
			};
			expect(check(opener)?.code).toBe('spliced-opener-closed');
			expect(check(`${opener}\n${container[2]}${closer}`)).toBeNull();
		}
	);

	it('an opener the splice only exposed is not asked', () => {
		const doc = parse('x\n```\n\n# Heading\n');
		doc.children.splice(1, 1, parse('```\n').children[0], parse('# Heading\n').children[0]);
		doc.children[2] = { ...doc.children[2], leadingTrivia: '\n' };
		expect(checkSplicedOpenersClosed(doc, 0, 2, '```js\nbody\n```\n', fixtureGrammar)).toBeNull();
	});
});
