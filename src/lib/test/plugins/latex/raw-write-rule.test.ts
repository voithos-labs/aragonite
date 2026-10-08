import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib';
import { normalizeOwnRaw } from '#lib/tree-operations/node-primitives.js';
import { documentLineEnding } from '#lib/plugin.js';
import { registerMathBlock } from '#lib/plugins/latex/latex-kind.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';

// Both math kinds declare a raw-write rule that puts back a closer a truncating write dropped, so
// bytes written past the block's editable element (a range delete, a paste, a search-replace)
// cannot leave the block open and degrade it.
// Miss-analysis: no math test handed the kind a slice cut by a tree operation.

/** The rule as a write path reaches it: dispatched off the node's own kind. */
function write(source: string, raw: string): string {
	const doc = parse(source);
	return normalizeOwnRaw(doc.children[0], raw, documentLineEnding(doc));
}

// One call registers both forms, as one install of the plugin does.
beforeEach(() => {
	registerMathBlock();
});

describe('a truncating write of a $$ block gets its closer back', () => {
	it.each([
		['the one-line form closes on line 0', '$$x^2$$\n', '$$After\n', '$$After$$\n'],
		['lines a join brought along stay their own', '$$x^2$$\n', '$$a\nb\n', '$$a$$\nb\n'],
		// A literal write's last line ending `$$` is a foreign line, not the formula's closer.
		['even a last one ending in $$', '$$x^2$$\n', '$$xoo\nprice 10$$\n', '$$xoo$$\nprice 10$$\n'],
		['a literal break mid-body', '$$x^2$$\n', '$$x\n^2$$\n', '$$x$$\n^2$$\n'],
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

// Miss-analysis: every row wrote a one-line form still on one line, so none handed the rule a
// one-line form a line break went into, which it read as a join and gave a second closer.
describe('a $$ write reads the shape the painter and the parser read', () => {
	it.each([
		['a break at the body’s end', '$$x^2$$\n', '$$x^2\n$$\n', '$$\nx^2\n\n$$\n'],
		['a CRLF break', '$$x^2$$\r\n', '$$x^2\r\n$$\r\n', '$$\r\nx^2\r\n\r\n$$\r\n']
	])('gives a one-line form holding %s the multi-line form', (_case, source, written, expected) => {
		expect(write(source, written)).toBe(expected);
	});

	it('moves an offset past each line ending it adds', () => {
		const doc = parse('$$x^2$$\n');
		const rule = tryGetBlockKindDescriptor(doc.children[0].kind)!.rawWrite!;
		const ctx = { node: doc.children[0], mode: 'authored' as const, lineEnding: '\n' as const };
		expect(rule.mapOffset('$$x^2\n$$\n', 6, ctx)).toBe(7);
		expect(rule.mapOffset('$$x^2\n$$\n', 2, ctx)).toBe(3);
	});

	// As text, a lone `$$` line opens a block that runs to the next `$$` anywhere below.
	it.each([
		['the opener’s dollar deleted', '$$\nx^2\n$$\n', '$\nx^2\n$$\n', '$\nx^2\n'],
		['a closer typed mid-body', '$$\nx\n$$\n', '$$\nx\n$$\nb\n$$\n', '$$\nx\n$$\nb\n']
	])('drops the closer stranded by %s', (_case, source, written, expected) => {
		expect(write(source, written)).toBe(expected);
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

	it('leaves a fence that still holds its closer alone', () => {
		expect(write('```math\nx^2\n```\n', '```math\ny\n```\n')).toBe('```math\ny\n```\n');
	});

	// Miss-analysis: no test wrote the two shapes the built-in code block repairs (GH #566).
	it('drops the closer a write stranded by taking the opener line', () => {
		expect(write('```math\nx^2\n```\n', 'x^2\n```\n')).toBe('x^2\n');
	});

	it('grows the fence past a body line that reads as the closer', () => {
		expect(write('```math\nx^2\n```\n', '```math\n```\nx^2\n```\n')).toBe(
			'````math\n```\nx^2\n````\n'
		);
	});
});

// Miss-analysis: every closer-restore fixture was LF, so none hit a CRLF last line with no ending.
describe('a closer restored into the unterminated last block of a CRLF document is CRLF', () => {
	it.each([
		['a $$ block', '$$\r\nx^2\r\n$$', '$$\r\nx^', '$$\r\nx^\r\n$$'],
		['a ```math fence', '```math\r\nx^2\r\n```', '```math\r\nAfter', '```math\r\nAfter\r\n```']
	])('%s', (_case, source, written, expected) => {
		expect(write(source, written)).toBe(expected);
	});
});

// Miss-analysis: the order checks read a math leaf's raw, so the closer this rule puts back read
// as added text, and no row asked what the rule calls the block's text.
describe('the rule reads a $$ block’s text without its fences', () => {
	// Whitespace aside, as the order checks read it.
	const textOf = (raw: string) => {
		const rule = tryGetBlockKindDescriptor(parse('$$x$$\n').children[0].kind)?.rawWrite;
		return rule?.text?.(raw).replace(/\s+/g, ' ').trim();
	};

	it('reads the same text before and after it puts the closer back', () => {
		expect(textOf('$$\nx\n')).toBe('x');
		expect(textOf(write('$$\nx\n$$\n', '$$\nx\n'))).toBe('x');
	});

	it('keeps what follows a one-line closer', () => {
		expect(textOf('$$x^2$$\nmore\n')).toBe('x^2 more');
	});
});
