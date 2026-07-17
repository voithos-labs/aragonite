import { describe, it, expect } from 'vitest';
import {
	matchDirectiveOpener,
	isDirectiveCloser,
	serializeDirective,
	parseDirectiveAttributes
} from '$lib/core/directive/grammar';

describe('matchDirectiveOpener', () => {
	it('parses a container opener with name and no info', () => {
		expect(matchDirectiveOpener(':::note')).toEqual({
			tier: 'container',
			colonCount: 3,
			name: 'note',
			info: ''
		});
	});
	it('captures info verbatim including the leading separator', () => {
		expect(matchDirectiveOpener(':::note  My Title ')).toEqual({
			tier: 'container',
			colonCount: 3,
			name: 'note',
			info: '  My Title '
		});
	});
	it('distinguishes leaf (exactly 2 colons) from container (≥3)', () => {
		expect(matchDirectiveOpener('::toc')?.tier).toBe('leaf');
		expect(matchDirectiveOpener('::::deep')).toEqual({
			tier: 'container',
			colonCount: 4,
			name: 'deep',
			info: ''
		});
	});
	it('declines a single colon and a nameless fence', () => {
		expect(matchDirectiveOpener(':x')).toBeNull();
		expect(matchDirectiveOpener(':::')).toBeNull();
	});
	it('admits hyphens and digits in a name after a letter start', () => {
		expect(matchDirectiveOpener(':::call-out')).toEqual({
			tier: 'container',
			colonCount: 3,
			name: 'call-out',
			info: ''
		});
		expect(matchDirectiveOpener(':::note-2 x')).toEqual({
			tier: 'container',
			colonCount: 3,
			name: 'note-2',
			info: ' x'
		});
	});
	it('ends the name at an underscore and requires a leading letter', () => {
		expect(matchDirectiveOpener(':::a_b')).toEqual({
			tier: 'container',
			colonCount: 3,
			name: 'a',
			info: '_b'
		});
		expect(matchDirectiveOpener(':::1x')).toBeNull();
	});
});

describe('isDirectiveCloser', () => {
	it('matches a colon run ≥ the opener count', () => {
		expect(isDirectiveCloser(':::', 3)).toBe(true);
		expect(isDirectiveCloser('::::', 3)).toBe(true);
		expect(isDirectiveCloser('::', 3)).toBe(false);
		expect(isDirectiveCloser('::: x', 3)).toBe(false);
	});
});

describe('serializeDirective', () => {
	it('round-trips opener colons, verbatim info, body wrap, and matched closer', () => {
		const out = serializeDirective({
			colonCount: 3,
			name: 'note',
			info: '  My Title',
			innerPrefix: '\n',
			body: 'hi\n',
			innerSuffix: '\n'
		});
		expect(out).toBe(':::note  My Title\n\nhi\n\n:::\n');
	});
	it('drops the closer newline for a document-final directive', () => {
		const out = serializeDirective({
			colonCount: 3,
			name: 'x',
			info: '',
			innerPrefix: '',
			body: 'y\n',
			innerSuffix: '',
			closerNewline: false
		});
		expect(out).toBe(':::x\ny\n:::');
	});
	it('widens the closer independently of the opener colon count', () => {
		const out = serializeDirective({
			colonCount: 3,
			name: 'x',
			info: '',
			innerPrefix: '',
			body: 'y\n',
			innerSuffix: '',
			closerColonCount: 4
		});
		expect(out).toBe(':::x\ny\n::::\n');
	});
	it('reproduces a CRLF line ending on the synthesized opener and closer lines', () => {
		const out = serializeDirective({
			colonCount: 3,
			name: 'note',
			info: ' Title',
			innerPrefix: '',
			body: 'body\r\n',
			innerSuffix: '',
			lineEnding: '\r\n'
		});
		expect(out).toBe(':::note Title\r\nbody\r\n:::\r\n');
	});
	it('emits the closer with its own ending when it differs from the opener', () => {
		const out = serializeDirective({
			colonCount: 3,
			name: 'x',
			info: '',
			innerPrefix: '',
			body: 'y\n',
			innerSuffix: '',
			lineEnding: '\n',
			closerLineEnding: '\r\n'
		});
		expect(out).toBe(':::x\ny\n:::\r\n');
	});
	it('defaults the closer ending to the opener ending when unspecified', () => {
		const out = serializeDirective({
			colonCount: 3,
			name: 'x',
			info: '',
			innerPrefix: '',
			body: 'y\r\n',
			innerSuffix: '',
			lineEnding: '\r\n'
		});
		expect(out).toBe(':::x\r\ny\r\n:::\r\n');
	});
});

describe('parseDirectiveAttributes', () => {
	it('reads a [label] and {#id .class key=val}', () => {
		expect(parseDirectiveAttributes(' [My Label]{#warn .danger title="a b"}')).toEqual({
			label: 'My Label',
			id: 'warn',
			classes: ['danger'],
			properties: { title: 'a b' }
		});
	});
	it('returns empty structure for bare info (callout title path)', () => {
		expect(parseDirectiveAttributes('  My Title')).toEqual({ classes: [], properties: {} });
	});
});
