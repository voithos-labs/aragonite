import { describe, it, expect } from 'vitest';
import { parseImageDimensions } from '../../../core/inline/image-dimensions';

describe('parseImageDimensions', () => {
	it.each([
		['plain alt', { displayAlt: 'plain alt', width: undefined, height: undefined }],
		['alt|400', { displayAlt: 'alt', width: 400, height: undefined }],
		['alt|400x300', { displayAlt: 'alt', width: 400, height: 300 }],
		['', { displayAlt: '', width: undefined, height: undefined }],
		['|400', { displayAlt: '', width: 400, height: undefined }],
		['multi|word|400', { displayAlt: 'multi|word', width: 400, height: undefined }],
		['alt|', { displayAlt: 'alt|', width: undefined, height: undefined }],
		['alt|abc', { displayAlt: 'alt|abc', width: undefined, height: undefined }],
		['alt|0', { displayAlt: 'alt|0', width: undefined, height: undefined }],
		['alt|-50', { displayAlt: 'alt|-50', width: undefined, height: undefined }],
		['alt|99999', { displayAlt: 'alt|99999', width: undefined, height: undefined }],
		['alt|400x', { displayAlt: 'alt|400x', width: undefined, height: undefined }],
		['alt|400x0', { displayAlt: 'alt|400x0', width: undefined, height: undefined }],
		// The pipe search is bounded to the longest decodable suffix, so a padded digit run
		// deliberately stops decoding and nested-label floods stay linear.
		['alt|10000x10000', { displayAlt: 'alt', width: 10000, height: 10000 }],
		['alt|000000000001', { displayAlt: 'alt|000000000001', width: undefined, height: undefined }]
	])('parses %s correctly', (input, expected) => {
		expect(parseImageDimensions(input)).toEqual(expected);
	});
});
