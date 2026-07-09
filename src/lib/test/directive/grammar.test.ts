import { describe, it, expect } from 'vitest';
import {
	matchDirectiveOpener,
	isDirectiveCloser,
	serializeDirective
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
});
