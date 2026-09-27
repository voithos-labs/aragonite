// A setext heading's bytes past its title: the structure every edit keeps after the title, and the
// kind's write rule, which drops it under a blank line.
// Miss-analysis: every tested kind with bytes past its content was prose, never component-drawn.
import { describe, it, expect, afterEach } from 'vitest';
import { structuralSuffix } from '../../core/inline';
import type { CstNode } from '../../core/nodes';
import { setextHeadingWrite } from '../../schema/setext-raw';
import type { WriteMode } from '../../schema/block-kind-descriptor';
import { simpleLeafClosure } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import { testLeaf } from '$lib/test/harness/test-kinds';

const node = (kind: string, raw: string) => ({ kind, leadingTrivia: '', raw }) as CstNode;

afterEach(resetPluginPlatformForTests);

describe('structuralSuffix', () => {
	it.each([
		['a setext underline', 'Plan\n===\n', '\n==='],
		['a CRLF setext underline', 'Plan\r\n---\r\n', '\r\n---'],
		['a two-line title', 'Plan\nmore\n---\n', '\n---']
	])('is %s', (_label, raw, suffix) => {
		expect(structuralSuffix(node('setextHeading', raw))).toBe(suffix);
	});

	it('is empty for a paragraph and an ATX heading', () => {
		expect(structuralSuffix(node('paragraph', 'Plan\n'))).toBe('');
		expect(structuralSuffix(node('heading', '# Plan\n'))).toBe('');
	});

	it('is empty for a kind that is not prose, whatever its content range', () => {
		const kind = testLeaf('short-range-leaf', {
			getContentRange: () => ({ start: 0, end: 2 }),
			closure: simpleLeafClosure({
				focus: { mode: 'implemented', via: 'native caret in the raw-editable surface' },
				searchPaint: { mode: 'inherit-default' },
				undo: { mode: 'inherit-default' },
				simOracle: { mode: 'inherit-default' }
			})
		});

		expect(structuralSuffix(node(kind, '@@ one\n'))).toBe('');
	});
});

describe.each(['authored', 'literal'] as const)('the setext write rule, %s', (mode: WriteMode) => {
	const write = (heading: CstNode, raw: string) =>
		setextHeadingWrite.normalize(raw, { node: heading, mode, lineEnding: '\n' });
	const heading = node('setextHeading', 'Plan\n===\n');

	it.each([
		['an emptied title', '\n===\n', '\n'],
		['a title of spaces and tabs', ' \t\n===\n', ' \t\n'],
		['a title ending in an empty line', 'Plan\n\n===\n', 'Plan\n\n'],
		['an emptied title with no line ending', '\n===', '']
	])('drops the underline under %s', (_label, raw, written) => {
		expect(write(heading, raw)).toBe(written);
	});

	it.each([
		['a title', 'Plans\n===\n'],
		['a no-break space, which Markdown reads as text', ' \n===\n'],
		['bytes that no longer end in the underline', '\n']
	])('keeps %s as written', (_label, raw) => {
		expect(write(heading, raw)).toBe(raw);
	});

	it('drops a CRLF underline and keeps the line ending', () => {
		expect(write(node('setextHeading', 'Plan\r\n---\r\n'), '\r\n---\r\n')).toBe('\r\n');
	});

	it('lands a caret past the dropped underline at the end of what is left', () => {
		const ctx = { node: heading, mode, lineEnding: '\n' } as const;
		expect(setextHeadingWrite.mapOffset('\n===\n', 4, ctx)).toBe(1);
		expect(setextHeadingWrite.mapOffset('Plans\n===\n', 5, ctx)).toBe(5);
	});
});
