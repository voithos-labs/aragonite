import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { normalizeOwnRaw } from '$lib/tree-operations/node-primitives';
import { documentLineEnding } from '$lib/plugin';
import { registerMathBlock } from '$lib/plugins/latex/latex-kind';

// Both math kinds declare a raw-write rule that puts back a closer a truncating write dropped, so
// bytes written past the block's editable element (a range delete, a paste, a search-replace)
// cannot leave the block open and degrade it.
// Miss-analysis: every math test wrote through the block's own editable element, where the user
// can see the fence bytes; nothing ever handed the kind a slice cut by a tree operation.

/** The rule as a write path reaches it: dispatched off the node's own kind. */
function write(source: string, raw: string): string {
	const doc = parse(source);
	return normalizeOwnRaw(doc.children[0], raw, documentLineEnding(doc));
}

// One call registers both forms, as one install of the plugin does.
beforeEach(() => {
	resetPluginPlatformForTests();
	registerMathBlock();
});

describe('a truncating write of a $$ block gets its closer back', () => {
	it.each([
		['the one-line form closes on line 0', '$$x^2$$\n', '$$After\n', '$$After$$\n'],
		['lines a join brought along stay their own', '$$x^2$$\n', '$$a\nb\n', '$$a$$\nb\n'],
		[
			'the multi-line form closes on a line of its own',
			'$$\nx^2\n$$\n',
			'$$\nx^\n',
			'$$\nx^\n$$\n'
		],
		['a write with no trailing ending keeps none', '$$x^2$$\n', '$$After', '$$After$$'],
		// A closer and nothing else: the rule restores bytes, so it never invents the empty body
		// line the Enter completer writes.
		['a write cut back to the opener closes with no body', '$$x^2$$\n', '$$\n', '$$\n$$\n']
	])('%s', (_case, source, written, expected) => {
		expect(write(source, written)).toBe(expected);
		expect(parse(write(source, written)).children[0].kind).toBe('mathBlock');
	});

	it.each([
		['bytes that already close', '$$x^2$$\n', '$$y$$\n'],
		['a multi-line form that still holds its closer', '$$\nx^2\n$$\n', '$$\ny\n$$\n'],
		['a first line that no longer opens the block', '$$x^2$$\n', 'x^2\n'],
		['a head cut that left the opener behind', '$$x^2$$\n', '2$$\n']
	])('leaves %s alone', (_case, source, written) => {
		expect(write(source, written)).toBe(written);
	});

	// Applied twice by two write paths in one operation, the second pass must add nothing.
	it('is idempotent', () => {
		const once = write('$$x^2$$\n', '$$After\n');
		expect(write('$$x^2$$\n', once)).toBe(once);
	});
});

describe('a truncating write of a ```math fence gets its closing line back', () => {
	it('closes on the run the written opener carries, not the block’s old one', () => {
		expect(write('```math\nx^2\n```\n', '````math\nAfter\n')).toBe('````math\nAfter\n````\n');
	});

	it('keeps an indented opener’s indent on the closer', () => {
		expect(write('   ```math\nx^2\n```\n', '   ```math\nAfter\n')).toBe(
			'   ```math\nAfter\n   ```\n'
		);
	});

	it.each([
		['a fence that still holds its closer', '```math\ny\n```\n'],
		['a first line that is no longer a math fence', 'x^2\n```\n']
	])('leaves %s alone', (_case, written) => {
		expect(write('```math\nx^2\n```\n', written)).toBe(written);
	});
});

// Miss-analysis: every closer-restore fixture was LF, so a closer written in LF into a CRLF block
// read as correct; the last line of a document carries no ending to copy.
describe('a closer restored into the unterminated last block of a CRLF document is CRLF', () => {
	it.each([
		['a $$ block', '$$\r\nx^2\r\n$$', '$$\r\nx^', '$$\r\nx^\r\n$$'],
		['a ```math fence', '```math\r\nx^2\r\n```', '```math\r\nAfter', '```math\r\nAfter\r\n```']
	])('%s', (_case, source, written, expected) => {
		expect(write(source, written)).toBe(expected);
	});
});
