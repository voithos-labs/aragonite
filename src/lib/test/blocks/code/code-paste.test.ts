// @vitest-environment jsdom
// A paste into a code block, by the editor's paste route: the text goes in literally, and the fence
// grows past any line the paste leaves that would close it.
import { afterEach, beforeAll, describe, it, expect } from 'vitest';
import { destroyMountedEditors, installLayoutStubs } from '../../harness/mount-editor.svelte';
import { pasteIntoCode as paste } from './paste-into-code';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

// ── code paste: no fence bump ─────────────────────────────────────────

describe('code paste: non-bumping paste', () => {
	it('inserts plain text at a collapsed cursor', async () => {
		const result = await paste({
			display: '```\nfoo\n```',
			selection: { start: 7, end: 7 },
			pasted: 'bar'
		});
		expect(result.text).toBe('```\nfoobar\n```');
		expect(result.cursor).toBe(10);
	});

	it('replaces a non-empty selection with the paste', async () => {
		const result = await paste({
			display: '```\nfoo\n```',
			selection: { start: 4, end: 7 },
			pasted: 'bar'
		});
		expect(result.text).toBe('```\nbar\n```');
		expect(result.cursor).toBe(7);
	});

	it('leaves fences alone when the paste has no fence runs', async () => {
		const result = await paste({
			display: '```\nfoo\n```',
			selection: { start: 4, end: 4 },
			pasted: 'x'
		});
		expect(result.text).toBe('```\nxfoo\n```');
		expect(result.cursor).toBe(5);
	});

	it('leaves fences alone when the paste has a shorter run than the outer fence', async () => {
		const result = await paste({
			display: '````\nfoo\n````',
			selection: { start: 5, end: 5 },
			pasted: '``'
		});
		expect(result.text).toBe('````\n``foo\n````');
		expect(result.cursor).toBe(7);
	});

	it('keeps multi-block Markdown as the body’s literal text', async () => {
		const result = await paste({
			display: '```\nfoo\n```',
			selection: { start: 4, end: 4 },
			pasted: '# h\n\n- x\n'
		});
		expect(result.text).toBe('```\n# h\n\n- x\nfoo\n```');
	});
});

// ── code paste: fence bump ────────────────────────────────────────────

describe('code paste: fence bump', () => {
	it('bumps closed fence when the paste contains a run equal to the outer fence', async () => {
		const result = await paste({
			display: '```\n\n```',
			selection: { start: 4, end: 4 },
			pasted: '```'
		});
		expect(result.text).toBe('````\n```\n````');
		expect(result.cursor).toBe(8);
	});

	it('bumps to one longer than the longest run in the paste', async () => {
		const result = await paste({
			display: '```\n\n```',
			selection: { start: 4, end: 4 },
			pasted: '`````'
		});
		expect(result.text).toBe('``````\n`````\n``````');
		expect(result.cursor).toBe(12);
	});

	it('bumps opener only when the fence is unclosed', async () => {
		const result = await paste({
			display: '```\nfoo\n',
			selection: { start: 8, end: 8 },
			pasted: '```'
		});
		expect(result.text).toBe('````\nfoo\n```');
		expect(result.cursor).toBe(12);
	});

	// The rule reads the lines the paste leaves behind, not the run inside it: a run landing
	// mid-line threatens nothing, one formed where the splice joins threatens everything.
	it('leaves the fence alone when the pasted run lands mid-line', async () => {
		const result = await paste({
			display: '```\nfoo\n```',
			selection: { start: 7, end: 7 },
			pasted: '```'
		});
		expect(result.text).toBe('```\nfoo```\n```');
	});

	it('bumps for a closer run the splice forms against the bytes already there', async () => {
		const result = await paste({
			display: '```\n`\n```',
			selection: { start: 4, end: 4 },
			pasted: '``'
		});
		expect(result.text).toBe('````\n```\n````');
	});

	it('leaves non-closer body lines alone even when they contain fence runs', async () => {
		const result = await paste({
			display: '```\n```inside\n```',
			selection: { start: 4, end: 4 },
			pasted: 'x'
		});
		expect(result.text).toBe('```\nx```inside\n```');
	});

	it('supports tilde fences', async () => {
		const result = await paste({
			display: '~~~\n\n~~~',
			selection: { start: 4, end: 4 },
			pasted: '~~~'
		});
		expect(result.text).toBe('~~~~\n~~~\n~~~~');
	});
});
