// @vitest-environment node
// A fenced container's title row ends in its title line's own line ending, so in a CRLF document a
// plugin reads the row's text as the document's bytes, its `\r` at the line's `\r`.
// Miss-analysis: every title-row row read an LF document, and the one CRLF row was details, whose
// title ends in `</summary>` and so never shows its line ending.
import { describe, expect, it } from 'vitest';
import { grammar, type Plugin } from '#lib/plugin.js';
import { folds } from '#lib/test/support/fold-fixture.js';
import { details } from '#packages/details/src/index.js';

const titleOf = (plugin: Plugin<object>, source: string) => {
	const doc = grammar([plugin]).parse(source);
	const title = [...doc.blocks[0].walk()].find((block) => block.type.name.endsWith('.title'))!;
	return { doc, title };
};

describe('a title row ends as its line does', () => {
	it('reads `T\\r\\n` in a CRLF document, its `\\r` at the line’s', () => {
		const { doc, title } = titleOf(folds, '[fold]\r\ntitle: T\r\n\r\nbody\r\n\r\n[/fold]\r\n');
		expect(title.text).toBe('T\r\n');
		expect(doc.text[title.byteAt(1)]).toBe('\r');
	});

	it('leaves a details summary’s text without its line break', () => {
		const { title } = titleOf(
			details,
			'<details>\r\n<summary>Sum</summary>\r\n\r\nbody\r\n\r\n</details>\r\n'
		);
		expect(title.text).toBe('Sum');
	});
});
