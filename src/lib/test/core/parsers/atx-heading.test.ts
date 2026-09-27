// Miss-analysis: the content range had its own prefix scan beside `matchHeading`, and every heading
// test wrote `# ` with a space and no closing run, so neither a tab nor a §4.2 closer was ever read.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { getContentRange, structuralSuffix } from '$lib/core/inline';
import { isBareHeadingOpener, matchHeading } from '$lib/core/parsers/heading';

/** Each ATX heading in `source`, as its content text and the bytes kept past it. */
function headings(source: string): Array<{ content: string; suffix: string }> {
	return parse(source)
		.children.filter((node) => node.kind === 'heading')
		.map((node) => {
			const range = getContentRange(node);
			return { content: node.raw.slice(range.start, range.end), suffix: structuralSuffix(node) };
		});
}

describe('the ATX heading content range (GFM §4.2)', () => {
	it('starts after a tab that follows the hashes', () => {
		expect(headings('#\tHi\n')).toEqual([{ content: 'Hi', suffix: '' }]);
	});

	// The spec strips the whitespace around the content; the range drops one space or tab on each
	// side, and any more stays text, so a space typed at the content's end stays where it was typed.
	it.each([
		['71', '## foo ##\n  ###   bar    ###\n', ['foo', ' ##'], ['  bar   ', ' ###']],
		['72', '# foo ##################################\n', ['foo', ' ' + '#'.repeat(34)]],
		['73', '### foo ###     \n', ['foo', ' ###     ']],
		['74', '### foo ### b\n', ['foo ### b', '']],
		['75', '# foo#\n', ['foo#', '']],
		[
			'76',
			'### foo \\###\n## foo #\\##\n# foo \\#\n',
			['foo \\###', ''],
			['foo #\\##', ''],
			['foo \\#', '']
		],
		['79', '## \n#\n### ###\n', ['', ''], ['', ''], ['', '###']]
	])('reads spec example %s', (_example, source, ...expected) => {
		expect(headings(source)).toEqual(expected.map(([content, suffix]) => ({ content, suffix })));
	});

	it('takes a closing run whose space before it is a tab', () => {
		expect(headings('# Hi\t#\n')).toEqual([{ content: 'Hi', suffix: '\t#' }]);
	});

	it('keeps a CRLF line ending out of both the content and the closing run', () => {
		expect(headings('# Hi #\r\n')).toEqual([{ content: 'Hi', suffix: ' #' }]);
	});
});

describe('matchHeading', () => {
	it('returns the level and the content range in one read', () => {
		expect(matchHeading('  ### Hi ##')).toEqual({ level: 3, contentStart: 6, contentEnd: 8 });
	});

	it('refuses seven hashes and hashes glued to text', () => {
		expect(matchHeading('####### foo')).toBeNull();
		expect(matchHeading('#hashtag')).toBeNull();
	});
});

describe('isBareHeadingOpener', () => {
	it.each([
		['#', true],
		['  ##\n', true],
		['# ', false],
		['# #', false],
		['#\t', false],
		['# Hi', false]
	])('%j is bare: %s', (raw, bare) => {
		expect(isBareHeadingOpener(raw)).toBe(bare);
	});
});
