// @vitest-environment jsdom
// A leaf write that replaced a selection of a `:::` opening row, leaving it fewer than three colons,
// unwraps the container as the range-edit core does for the same range, and a write with no
// selection (a key at a caret) stays literal.
// Miss-analysis: the leaf write saw only bytes, so a selection's removal and a word delete that
// left the same row wrote the same half-open box, and no row compared the write with the core.
// The comparison then took seven hand-picked ranges of a titled row, so none typed over a range
// that leaves no title, where the core joined the text to the body or kept the closing line.
import { describe, expect, it } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { editRange } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { makeContainerHarness, makeNestedHarness } from '#lib/test/harness/editor-actions.js';
import { makeSearchReplace, scanCompiled } from '#lib/test/harness/search-replace.js';
import { noTransforms, testReading } from '../range-edit/test-host';
import type { Mode } from '#lib/range-edit/host.js';

const G = ':::foo Title\nbody\n:::\n';

async function write(
	source: string,
	row: string,
	start: number,
	end: number,
	typed = '',
	over = true
) {
	// The bundled plugins register the `:::` grammar the harness reads with.
	testReading();
	const h = makeNestedHarness(source, { index: 0 });
	const text = row.slice(0, start) + typed + row.slice(end);
	const selection = over ? { start, end } : undefined;
	await h.bundle.blockEdit.updateBlockContent(
		0,
		text,
		'authored',
		'join-typing',
		end,
		start + typed.length,
		selection
	);
	return serialize(h.deps.doc);
}

function core(source: string, from: number, to: number, typed: string, mode: Mode = 'source') {
	const reading = testReading();
	const tree = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
	const host = noTransforms(rangeHost(reading, { source, measured: measured(tree) }));
	const gesture = typed === '' ? ('backspace' as const) : { text: typed };
	return editRange(source, { from, to }, gesture, mode, host).source;
}

/** Every range of `row` from inside its marker, `marker` bytes long, whose removal leaves fewer
 *  than three colons, counted here apart from the rule's own module. */
function breakingRanges(row: string, marker: number): [number, number][] {
	const line = row.replace(/\r?\n$/, '');
	const ranges: [number, number][] = [];
	for (let start = 0; start < marker; start++)
		for (let end = start + 1; end <= line.length; end++)
			if (/^:*/.exec(line.slice(0, start) + line.slice(end))![0].length < 3)
				ranges.push([start, end]);
	return ranges;
}

// The shapes the leaf write reaches at the top level; the nested ones are `opener-unwrap.test.ts`.
const SHAPES = [
	['a titled row', ':::tip Title\nbody\n:::\n', 7],
	['an untitled row', ':::tip\nbody\n:::\n', 6],
	['a generic box', G, 7],
	['four colons', '::::note Title\nbody\n::::\n', 9],
	['no final line ending', ':::tip Title\nbody\n:::', 7],
	['CRLF', ':::tip Title\r\nbody\r\n:::\r\n', 7],
	['over a heading', ':::tip Title\n# H\n:::\n', 7]
] as const;

const PARITY = SHAPES.flatMap(([shape, source, marker]) => {
	const row = source.slice(0, source.indexOf('\n') + 1);
	return breakingRanges(row, marker).flatMap(([start, end]) =>
		['', 'Q'].map(
			(typed) =>
				[
					`${shape} [${start}, ${end}) ${typed || 'removed'}`,
					source,
					row,
					marker,
					start,
					end,
					typed
				] as const
		)
	);
});

describe('a selection written over an opening row', () => {
	// Live mode reads a range through a title's whole text as that title, which is no break.
	it.each(PARITY)(
		'%s: the leaf write gives the core its bytes, closing line gone',
		async (_, source, row, marker, start, end, typed) => {
			const written = await write(source, row, start, end, typed);
			expect(written).not.toMatch(/:::\r?\n?$/);
			expect(written).toBe(core(source, start, end, typed));
			const whole = end === row.trimEnd().length && end > marker;
			if (!whole) expect(written).toBe(core(source, start, end, typed, 'live'));
		}
	);

	it.each([
		['the marker', G, 0, 7, '', 'Title\n\nbody\n'],
		['the colons', G, 0, 3, '', 'Title\n\nbody\n'],
		['one colon', G, 1, 2, '', 'Title\n\nbody\n'],
		['the row whole', G, 0, 12, '', 'body\n'],
		['the marker, then a letter', G, 0, 7, 'Q', 'QTitle\n\nbody\n'],
		['the marker, then a colon', G, 0, 7, ':', ':Title\n\nbody\n'],
		['over a heading', ':::foo Title\n# H\n:::\n', 0, 7, '', 'Title\n# H\n']
	] as const)(
		'%s unwraps the box as the core does',
		async (_, source, start, end, typed, after) => {
			const row = source.slice(0, source.indexOf('\n') + 1);
			expect(await write(source, row, start, end, typed)).toBe(after);
			expect(core(source, start, end, typed)).toBe(after);
		}
	);

	it.each([
		['the name, leaving three colons', 3, 6, '::: Title\nbody\n:::\n'],
		['the title alone', 7, 12, ':::foo \nbody\n:::\n']
	] as const)('%s keeps the box half-open or whole, as today', async (_, start, end, after) => {
		expect(await write(G, ':::foo Title\n', start, end)).toBe(after);
	});

	// Live mode writes a selection of the row whole as its title cleared, its marker kept.
	it('the row whole written back as its marker keeps the box', async () => {
		expect(await write(G, ':::foo Title\n', 0, 12, ':::foo ')).toBe(':::foo \nbody\n:::\n');
	});

	it('the same bytes written with no selection, as a word delete writes them, stay literal', async () => {
		expect(await write(G, ':::foo Title\n', 0, 3, '', false)).toBe('foo Title\nbody\n:::\n');
	});

	// A program's write names no selection, so the rule leaves it literal.
	it('a plugin replaceRaw of the row stays literal', async () => {
		testReading();
		const h = makeContainerHarness(G, [0]);
		expect(await h.bundle.blockEdit.replaceRaw(0, 'foo Title\n')).toBe(true);
		expect(serialize(h.deps.doc)).toBe('foo Title\nbody\n:::\n');
	});

	it('a find and replace over the marker stays literal', async () => {
		testReading();
		const { deps, sr } = makeSearchReplace(G);
		await sr.replaceAll(
			scanCompiled(deps.doc, ':::foo ', { regex: false, caseSensitive: true }),
			''
		);
		expect(serialize(deps.doc)).toBe('Title\nbody\n:::\n');
	});

	// A box flush under a paragraph: what the unwrap leaves joins it, as any pair an edit uncovers.
	it.each([
		['its colons', 0, 3, 'x\nner\n\n# h\n'],
		['its row whole', 0, 6, 'x\nner\n\n# h\n']
	] as const)(
		'a box under a paragraph, %s removed, unwraps as the core does',
		async (_, start, end, after) => {
			testReading();
			const h = makeNestedHarness('x\n:::tip\nner\n:::\n\n# h\n', { index: 1 });
			const row = ':::tip\n';
			const text = row.slice(0, start) + row.slice(end);
			await h.bundle.blockEdit.updateBlockContent(0, text, 'authored', 'join-typing', end, start, {
				start,
				end
			});
			expect(serialize(h.deps.doc)).toBe(after);
			expect(core('x\n:::tip\nner\n:::\n\n# h\n', start + 2, end + 2, '')).toBe(after);
		}
	);
});
