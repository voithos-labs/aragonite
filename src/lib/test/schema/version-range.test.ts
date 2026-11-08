// The npm ranges a plugin's `editor` field is written in, read the way npm reads them.
import { describe, expect, it } from 'vitest';
import { satisfiesRange } from '#lib/schema/version-range.js';

describe('satisfiesRange', () => {
	it.each([
		['0.11.5', '^0.11.5', true],
		['0.11.9', '^0.11.5', true],
		['0.12.0', '^0.11.5', false],
		['0.11.4', '^0.11.5', false],
		['0.0.3', '^0.0.3', true],
		['0.0.4', '^0.0.3', false],
		['1.9.0', '^1.2.3', true],
		['2.0.0', '^1.2.3', false],
		['0.11.5', '~0.11.0', true],
		['0.12.0', '~0.11.0', false],
		['1.4.0', '~1', true],
		['0.11.5', '0.11.x', true],
		['0.12.0', '0.11.x', false],
		['0.11.5', '0.11.5', true],
		['0.11.4', '0.11.5', false],
		['0.11.5', '>=0.11.0 <0.12.0', true],
		['0.12.0', '>=0.11.0 <0.12.0', false],
		['0.11.5', '^0.10.0 || ^0.11.0', true],
		['0.11.5', '*', true],
		['0.11.5', 'latest', false]
	])('%s in %s: %s', (version, range, expected) => {
		expect(satisfiesRange(version, range)).toBe(expected);
	});
});
