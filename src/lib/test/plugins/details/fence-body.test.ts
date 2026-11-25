// The close-scan must track fenced code in the body: inside a fence, `</details>` is
// content and `<details>` must not inflate the depth. Bytes round-trip either way, so
// a fence-blind scan fails structurally (early close, spurious decline), not visibly.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse, serialize } from '#lib';
import { DETAILS, SUMMARY, detailsGrammar } from '#lib/test/support/details-grammar.js';

let grammar: ReturnType<typeof detailsGrammar>;
const read = (source: string) => parse(source, { grammar });

describe('details fence-aware close scan', () => {
	beforeEach(() => {
		grammar = detailsGrammar();
	});

	it('does not close early on a fenced </details> in the body', () => {
		const src = '<details>\n<summary>T</summary>\n\n```\n</details>\n```\n\n</details>\n';
		const doc = read(src);
		expect(doc.children.length).toBe(1);
		expect(doc.children[0].kind).toBe(DETAILS);
		expect(doc.children[0].children?.map((c) => c.kind)).toEqual([SUMMARY, 'fencedCode']);
		expect(serialize(doc)).toBe(src);
	});

	it('does not inflate the depth on a fenced <details> in the body', () => {
		const src = '<details>\n<summary>T</summary>\n\n```\n<details>\n```\n\n</details>\n';
		const doc = read(src);
		expect(doc.children.length).toBe(1);
		expect(doc.children[0].kind).toBe(DETAILS);
		expect(serialize(doc)).toBe(src);
	});

	it('still round-trips a real nested details (fence tracking leaves genuine nesting alone)', () => {
		const src =
			'<details>\n<summary>Outer</summary>\n\n' +
			'<details>\n<summary>Inner</summary>\n\ninner\n\n</details>\n\n' +
			'</details>\n';
		const doc = read(src);
		expect(doc.children[0].kind).toBe(DETAILS);
		expect(doc.children[0].children?.map((c) => c.kind)).toEqual([SUMMARY, DETAILS]);
		expect(serialize(doc)).toBe(src);
	});
});
