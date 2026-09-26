import { describe, it, expect } from 'vitest';
import { pasteThroughWrite as paste } from './paste-through-write';

// ── code paste: no fence bump ─────────────────────────────────────────

describe('code paste: non-bumping paste', () => {
	it('inserts plain text at a collapsed cursor', () => {
		const result = paste({
			display: '```\nfoo\n```',
			selection: { start: 7, end: 7 },
			pasted: 'bar'
		});
		expect(result.text).toBe('```\nfoobar\n```');
		expect(result.cursor).toBe(10);
	});

	it('replaces a non-empty selection with the paste', () => {
		const result = paste({
			display: '```\nfoo\n```',
			selection: { start: 4, end: 7 },
			pasted: 'bar'
		});
		expect(result.text).toBe('```\nbar\n```');
		expect(result.cursor).toBe(7);
	});

	it('leaves fences alone when the paste has no fence runs', () => {
		const result = paste({
			display: '```\nfoo\n```',
			selection: { start: 4, end: 4 },
			pasted: 'x'
		});
		expect(result.text).toBe('```\nxfoo\n```');
		expect(result.cursor).toBe(5);
	});

	it('leaves fences alone when the paste has a shorter run than the outer fence', () => {
		const result = paste({
			display: '````\nfoo\n````',
			selection: { start: 5, end: 5 },
			pasted: '``'
		});
		expect(result.text).toBe('````\n``foo\n````');
		expect(result.cursor).toBe(7);
	});
});

// ── code paste: fence bump ────────────────────────────────────────────

describe('code paste: fence bump', () => {
	it('bumps closed fence when the paste contains a run equal to the outer fence', () => {
		const result = paste({ display: '```\n\n```', selection: { start: 4, end: 4 }, pasted: '```' });
		expect(result.text).toBe('````\n```\n````');
		expect(result.cursor).toBe(8);
	});

	it('bumps to one longer than the longest run in the paste', () => {
		const result = paste({
			display: '```\n\n```',
			selection: { start: 4, end: 4 },
			pasted: '`````'
		});
		expect(result.text).toBe('``````\n`````\n``````');
		expect(result.cursor).toBe(12);
	});

	it('bumps opener only when the fence is unclosed', () => {
		const result = paste({
			display: '```\nfoo\n',
			selection: { start: 8, end: 8 },
			pasted: '```'
		});
		expect(result.text).toBe('````\nfoo\n```');
		expect(result.cursor).toBe(12);
	});

	// The rule reads the lines the paste leaves behind, not the run inside it: a run landing
	// mid-line threatens nothing, one formed where the splice joins threatens everything.
	it('leaves the fence alone when the pasted run lands mid-line', () => {
		const result = paste({
			display: '```\nfoo\n```',
			selection: { start: 7, end: 7 },
			pasted: '```'
		});
		expect(result.text).toBe('```\nfoo```\n```');
	});

	it('bumps for a closer run the splice forms against the bytes already there', () => {
		const result = paste({ display: '```\n`\n```', selection: { start: 4, end: 4 }, pasted: '``' });
		expect(result.text).toBe('````\n```\n````');
	});

	it('leaves non-closer body lines alone even when they contain fence runs', () => {
		const result = paste({
			display: '```\n```inside\n```',
			selection: { start: 4, end: 4 },
			pasted: 'x'
		});
		expect(result.text).toBe('```\nx```inside\n```');
	});

	it('supports tilde fences', () => {
		const result = paste({
			display: '~~~\n\n~~~',
			selection: { start: 4, end: 4 },
			pasted: '~~~'
		});
		expect(result.text).toBe('~~~~\n~~~\n~~~~');
	});
});
