// @vitest-environment jsdom
// A leaf write that replaced a selection of a `:::` opening row, leaving it fewer than three colons,
// unwraps the container as the range-edit core does for the same range, and a write with no
// selection (a key at a caret) stays literal.
// Miss-analysis: the leaf write saw only bytes, so a selection's removal and a word delete that
// left the same row wrote the same half-open box, and no row compared the write with the core.
import { describe, expect, it } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { editRange } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { makeContainerHarness, makeNestedHarness } from '#lib/test/harness/editor-actions.js';
import { makeSearchReplace, scanCompiled } from '#lib/test/harness/search-replace.js';
import { noTransforms, testReading } from '../range-edit/test-host';

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

function core(source: string, from: number, to: number, typed: string) {
	const reading = testReading();
	const tree = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
	const host = noTransforms(rangeHost(reading, { source, measured: measured(tree) }));
	const gesture = typed === '' ? ('backspace' as const) : { text: typed };
	return editRange(source, { from, to }, gesture, 'source', host).source;
}

describe('a selection written over an opening row', () => {
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
});
