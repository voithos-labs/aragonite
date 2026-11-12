// An edit's window reaches as far as a reading declares, by the reading's own rule and not the
// link definition's: a test block that waits on a body below it, across a heading's line but not
// across a `!!` line, reads as a parse reads it when a change closes the body or takes away the
// line that ended it.
// Miss-analysis: new surface; the window knew one reading no line closes, the definition's, and
// where that one's wait ends was written into the window itself.
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { serialize } from '#lib/core/serializer.js';
import { OPENER_PRIORITIES, type BlockOpener } from '#lib/plugin.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { initDocument } from '#lib/components/editor-root/document-swap.js';
import { assignChildIdsDeep } from '#lib/block-id.js';
import { spliceReading } from '#lib/tree-operations/byte-splice.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { changesBetween } from '#lib/tree-operations/byte-changes.js';
import { reloadDivergence } from '#lib/test/exhaustive/edit-driver.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';

const OPENS = /^%%tag\b/;

/** Where the body under a `%%tag` line ends: the index of its `>>` line among `lines`, `open` where
 *  the lines ran out first, `none` where no body starts or a blank or `!!` line cut it. */
function bodyEnd(lines: readonly string[]): number | 'open' | 'none' {
	if (lines.length === 1) return 'open';
	if (!lines[1].startsWith('<<')) return 'none';
	for (let i = 1; i < lines.length; i++) {
		if (i > 1 && (lines[i].trim() === '' || lines[i].startsWith('!!'))) return 'none';
		if (lines[i].endsWith('>>')) return i;
	}
	return 'open';
}

/** A `%%tag` line, alone or with a `<<` to `>>` body under it. Its wait runs across any line but
 *  a `!!` one, a heading's included, where a link definition's stops. */
const tagged: BlockOpener = {
	priority: OPENER_PRIORITIES.fencedCode + 7,
	interruptsParagraph: (line) => OPENS.test(line),
	readingNotFinal: {
		notFinal: (raw) => {
			const lines = raw.replace(/\r?\n$/, '').split(/\r?\n/);
			return OPENS.test(lines[0]) && bodyEnd(lines) === 'open';
		},
		mayClose: () => false,
		closer: null,
		crosses: (line) => !line.startsWith('!!')
	},
	tryOpen(ctx) {
		if (!OPENS.test(ctx.line.text)) return null;
		const end = bodyEnd(ctx.lines.slice(ctx.index, ctx.end).map((line) => line.text));
		const consumed = typeof end === 'number' ? end + 1 : 1;
		const raw = ctx.lines
			.slice(ctx.index, ctx.index + consumed)
			.map((line) => line.raw)
			.join('');
		return { node: { kind: 'tagged', leadingTrivia: ctx.leadingTrivia, raw } as CstNode, consumed };
	}
};

/** How the tree a splice from `before` to `after` leaves differs from a parse of `after`. */
function divergence(before: string, after: string): string | null {
	const doc: Document = initDocument(before, defaultGrammarView).doc;
	for (const block of doc.children) assignChildIdsDeep(block);
	const reading = spliceReading(
		measured(doc),
		before,
		changesBetween(before, after),
		defaultGrammarView
	);
	for (const window of [...(reading?.windows ?? [])].reverse())
		doc.children.splice(window.at, window.count, ...window.blocks);
	if (reading) doc.suffix = reading.suffix;
	const bytes = serialize(doc);
	if (bytes !== after) return `bytes ${JSON.stringify(bytes)}`;
	return after === '' ? null : reloadDivergence(doc, after);
}

const quoted = (text: string) =>
	text
		.split('\n')
		.map((line, i, all) => (i === all.length - 1 ? line : line === '' ? '>' : `> ${line}`))
		.join('\n');

describe('a window under a reading that declares what its wait crosses', () => {
	beforeEach(() => testLeaf('tagged', { opener: tagged }));

	it('reads the test block as declared', () => {
		const kinds = (source: string) =>
			initDocument(source, defaultGrammarView).doc.children.map((block) => block.kind);
		expect(kinds('%%tag a\n<<b\n# h\nend>>\n\nlast\n')).toEqual(['tagged', 'paragraph']);
		expect(kinds('%%tag a\n<<b\n!!x\nend>>\n')).toEqual(['tagged', 'paragraph']);
		expect(kinds('%%tag a\n<<b\n# h\nend\n')).toEqual([
			'tagged',
			'paragraph',
			'heading',
			'paragraph'
		]);
	});

	it.each([
		[
			'a body closed two headings down',
			'%%tag a\n<<b\n# h\n# i\nend\n\nlast\n',
			'%%tag a\n<<b\n# h\n# i\nend>>\n\nlast\n'
		],
		[
			'the line that ended a body taken, a heading under it',
			'%%tag a\n<<b\n!!x\n# h\ntext\nend>>\n\nlast\n',
			'%%tag a\n<<b\n# h\ntext\nend>>\n\nlast\n'
		],
		[
			'a closing mark written under a line that still ends the body',
			'%%tag a\n<<b\n!!x\n# h\nend\n\nlast\n',
			'%%tag a\n<<b\n!!x\n# h\nend>>\n\nlast\n'
		],
		[
			'a body closed under a link definition that waits too',
			'[a]: /u\n    "code\n%%tag a\n<<b\n# h\nend\n\nlast\n',
			'[a]: /u\n    "code\n%%tag a\n<<b\n# h\nend>>\n\nlast\n'
		]
	])('%s, at the top level and in a quote', (_name, before, after) => {
		expect(divergence(before, after)).toBeNull();
		expect(divergence(`${quoted(before)}\nafter\n`, `${quoted(after)}\nafter\n`)).toBeNull();
	});

	it('any one line changed under the test block', () => {
		const LINES = ['%%tag a', '<<b', '# h', 'text', '!!x', '', 'end', 'end>>', '[a]: /u', '    c'];
		const arbLine = fc.constantFrom(...LINES);
		fc.assert(
			fc.property(
				fc.array(arbLine, { minLength: 1, maxLength: 6 }),
				fc.nat(8),
				fc.option(arbLine),
				fc.boolean(),
				(mids, pick, line, inQuote) => {
					const lines = ['%%tag a', '<<b', ...mids, '', 'last'];
					const at = 1 + (pick % (lines.length - 3));
					const now = [...lines];
					if (line === null) now.splice(at, 1);
					else now[at] = line;
					const text = (all: string[]) =>
						inQuote ? `${quoted(all.join('\n') + '\n')}\nafter\n` : all.join('\n') + '\n';
					fc.pre(text(lines) !== text(now));
					expect(divergence(text(lines), text(now))).toBeNull();
				}
			),
			{ numRuns: 400, seed: freshOrFixedSeed(20261115) }
		);
	});
});
