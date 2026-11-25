import { describe, it, expect, beforeEach } from 'vitest';
import { parse, serialize } from '#lib';
import { detailsGrammar } from '#lib/test/support/details-grammar.js';
import { writeContainerRaw } from '#lib/schema/container-writer.js';

// The three tag lines the details writer builds reproduce the authored line ending rather than
// rewrite CRLF to `\n`, as a directive's lines do.

let grammar: ReturnType<typeof detailsGrammar>;
const read = (source: string) => parse(source, { grammar });

const CRLF_SRC = '<details>\r\n<summary>T</summary>\r\n\r\nbody\r\n\r\n</details>\r\n';
const LF_SRC = '<details>\n<summary>T</summary>\n\nbody\n\n</details>\n';

describe('details rebuild preserves CRLF chrome line endings', () => {
	beforeEach(() => {
		grammar = detailsGrammar();
	});

	it('reproduces CRLF on all three chrome lines after a body-child rebuild', () => {
		const details = read(CRLF_SRC).children[0];
		// Structural edit: rewrite the body child, then rebuild (what a commit does).
		details.children![1].raw = 'edited\r\n';
		writeContainerRaw(details, grammar);
		expect(details.raw).toBe(
			'<details>\r\n<summary>T</summary>\r\n\r\nedited\r\n\r\n</details>\r\n'
		);
	});

	it('reproduces CRLF chrome for an open details', () => {
		const src = '<details open>\r\n<summary>Title</summary>\r\n\r\nBody\r\n\r\n</details>\r\n';
		const details = read(src).children[0];
		writeContainerRaw(details, grammar);
		expect(details.raw).toBe(src);
	});

	it('keeps `\\n` chrome lines for an LF-authored details after rebuild (unchanged)', () => {
		const details = read(LF_SRC).children[0];
		details.children![1].raw = 'edited\n';
		writeContainerRaw(details, grammar);
		expect(details.raw).toBe('<details>\n<summary>T</summary>\n\nedited\n\n</details>\n');
	});

	it('round-trips the CRLF source byte-for-byte through parse+serialize', () => {
		expect(serialize(read(CRLF_SRC))).toBe(CRLF_SRC);
	});
});
