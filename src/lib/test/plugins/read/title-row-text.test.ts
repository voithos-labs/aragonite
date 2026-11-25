// A title row's text is its bytes in the document: up to and past its line ending where the title
// ends the line, and stopping at the title where its container closes the line (`</summary>`).
// Miss-analysis: every titled container a read row ran had nothing after its title on the line, so
// the row's own line feed always landed on the document's, and no row read a `<summary>` title.
import { describe, expect, it } from 'vitest';
import { grammar } from '#lib/plugin.js';
import { details } from '#packages/details/src/index.js';
import { folds } from '#lib/test/support/fold-fixture.js';

describe('a title row read', () => {
	it.each([
		['closed by its container', details, '<details>\n<summary>Sum</summary>\n', 'Sum'],
		['ending its line', folds, '[fold]\ntitle: Sum\n', 'Sum\n']
	])('%s holds its own bytes, each character at its byte', (_, plugin, head, text) => {
		const source = `x\n\n${head}\nbody\n\n${head.startsWith('<') ? '</details>' : '[/fold]'}\n`;
		const [, section] = grammar([plugin]).parse(source).blocks;
		const row = [...section.walk()][1];
		const at = source.indexOf('Sum');
		expect(row.text).toBe(text);
		expect([...row.text].map((_, i) => source[row.byteAt(i)]).join('')).toBe(text);
		expect([row.from, row.to]).toEqual([at, at + text.length]);
	});
});
