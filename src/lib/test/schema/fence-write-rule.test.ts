// The fence write rule in the shape every kind declares: bytes and caret through one pass, and a
// mode that tells the user typing the fence apart from content arriving whole.
// Miss-analysis: the rule's caret half lived beside the code block's typing path only, so a write
// from anywhere else threw the caret away, and nothing tested the rule with a caret at all.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { fencedCodeWrite } from '$lib/schema/fenced-code-raw';
import type { WriteContext } from '$lib/schema/block-kind-descriptor';

const ctxFor = (source: string, mode: WriteContext['mode']): WriteContext => ({
	node: parse(source).children[0],
	mode,
	lineEnding: '\n'
});

describe('the fence rule: authored against literal', () => {
	// Typing the closer of an open fence closes it. Routing typing through a rule that read every
	// write as content grew the opener instead, so the fence could never be closed by typing.
	const open = '```js\ncode\n';
	const typedCloser = '```js\ncode\n```\n';

	it('leaves a closer typed into an open fence as typed', () => {
		expect(fencedCodeWrite.normalize(typedCloser, ctxFor(open, 'authored'))).toBe(typedCloser);
	});

	it('grows the opener past the same line when it arrives as content', () => {
		expect(fencedCodeWrite.normalize(typedCloser, ctxFor(open, 'literal'))).toBe(
			'````js\ncode\n```\n'
		);
	});
});

describe('the fence rule: the caret follows the bytes', () => {
	const closed = ctxFor('```js\nbody\n```\n', 'literal');

	it('moves a caret past a grown opener run by the bytes it gained', () => {
		const written = '```js\n```\n```\n';
		expect(fencedCodeWrite.normalize(written, closed)).toBe('````js\n```\n````\n');
		expect(fencedCodeWrite.mapOffset(written, 3, closed)).toBe(3);
		expect(fencedCodeWrite.mapOffset(written, 5, closed)).toBe(6);
		expect(fencedCodeWrite.mapOffset(written, written.length, closed)).toBe(16);
	});

	it('lands a caret inside a dropped stranded closer where that closer was', () => {
		const written = 'dy\n```\n';
		expect(fencedCodeWrite.normalize(written, closed)).toBe('dy\n');
		expect([0, 2, 3, 5, 6, 7].map((at) => fencedCodeWrite.mapOffset(written, at, closed))).toEqual([
			0, 2, 2, 2, 2, 3
		]);
	});

	it('keeps every offset when the closer comes back after the written bytes', () => {
		const written = '```js\nbo\n';
		expect(fencedCodeWrite.normalize(written, closed)).toBe('```js\nbo\n```\n');
		expect(fencedCodeWrite.mapOffset(written, 8, closed)).toBe(8);
		expect(fencedCodeWrite.mapOffset(written, 9, closed)).toBe(9);
	});
});
