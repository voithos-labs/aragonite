import { describe, it, expect } from 'vitest';
import type { InlineNode } from '../../../core/nodes';
import { scanEscapes } from '../../../core/inline/escapes';

const ESCAPABLE = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

describe('scanEscapes', () => {
	it('recognizes every escapable ASCII punctuation char', () => {
		for (const ch of ESCAPABLE) {
			const raw = `\\${ch}`;
			const result = scanEscapes(raw, 0, raw.length, []);
			const escapes = result.filter((n) => n.kind === 'escape');
			expect(escapes, `escapable: \\${ch}`).toHaveLength(1);
			expect(escapes[0].start).toBe(0);
			expect(escapes[0].end).toBe(2);
		}
	});

	it('does not escape non-punctuation', () => {
		for (const raw of ['\\a', '\\1', '\\ ', '\\\t']) {
			const result = scanEscapes(raw, 0, raw.length, []);
			expect(
				result.every((n) => n.kind === 'text'),
				`should be text: ${JSON.stringify(raw)}`
			).toBe(true);
		}
	});

	it('treats \\\\X as one escape covering \\\\ then plain text X', () => {
		const raw = '\\\\*';
		const result = scanEscapes(raw, 0, raw.length, []);
		const escapes = result.filter((n) => n.kind === 'escape');
		expect(escapes).toHaveLength(1);
		expect(escapes[0].start).toBe(0);
		expect(escapes[0].end).toBe(2);
		const tail = result.find((n) => n.start === 2);
		expect(tail?.kind).toBe('text');
		expect(tail?.text).toBe('*');
	});

	it('emits trailing \\ at end of input as text', () => {
		const raw = 'foo\\';
		const result = scanEscapes(raw, 0, raw.length, []);
		expect(result.every((n) => n.kind === 'text')).toBe(true);
	});

	it('emits \\\\n (backslash + newline) as text — owned by hard-line-break', () => {
		const raw = 'foo\\\nbar';
		const result = scanEscapes(raw, 0, raw.length, []);
		expect(result.every((n) => n.kind === 'text')).toBe(true);
	});

	it('skips inside occupied (e.g. code span) ranges', () => {
		const raw = 'a `\\*` b';
		const codeSpan: InlineNode = { kind: 'inlineCode', start: 2, end: 6, text: '\\*' };
		const result = scanEscapes(raw, 0, raw.length, [codeSpan]);
		const escapes = result.filter((n) => n.kind === 'escape');
		expect(escapes).toHaveLength(0);
		expect(result.some((n) => n.kind === 'inlineCode')).toBe(true);
	});

	it('emits absolute offsets when scanning a sub-range', () => {
		const raw = 'xx\\*yy';
		const result = scanEscapes(raw, 2, 6, []);
		const escape = result.find((n) => n.kind === 'escape');
		expect(escape?.start).toBe(2);
		expect(escape?.end).toBe(4);
	});

	it('produces no escape for backslash alone in text', () => {
		const raw = 'a \\ b';
		const result = scanEscapes(raw, 0, raw.length, []);
		expect(result.every((n) => n.kind === 'text')).toBe(true);
	});
});
