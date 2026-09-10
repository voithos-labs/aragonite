import { describe, it, expect } from 'vitest';
import { parseImageDimensions } from '../../../core/inline/image-dimensions';

describe('parseImageDimensions', () => {
	it.each([
		[
			'plain alt',
			{ displayAlt: 'plain alt', width: undefined, height: undefined, crop: undefined }
		],
		['alt|400', { displayAlt: 'alt', width: 400, height: undefined, crop: undefined }],
		['alt|400x300', { displayAlt: 'alt', width: 400, height: 300, crop: undefined }],
		['', { displayAlt: '', width: undefined, height: undefined, crop: undefined }],
		['|400', { displayAlt: '', width: 400, height: undefined, crop: undefined }],
		[
			'multi|word|400',
			{ displayAlt: 'multi|word', width: 400, height: undefined, crop: undefined }
		],
		['alt|', { displayAlt: 'alt|', width: undefined, height: undefined, crop: undefined }],
		['alt|abc', { displayAlt: 'alt|abc', width: undefined, height: undefined, crop: undefined }],
		['alt|0', { displayAlt: 'alt|0', width: undefined, height: undefined, crop: undefined }],
		['alt|-50', { displayAlt: 'alt|-50', width: undefined, height: undefined, crop: undefined }],
		[
			'alt|99999',
			{ displayAlt: 'alt|99999', width: undefined, height: undefined, crop: undefined }
		],
		['alt|400x', { displayAlt: 'alt|400x', width: undefined, height: undefined, crop: undefined }],
		[
			'alt|400x0',
			{ displayAlt: 'alt|400x0', width: undefined, height: undefined, crop: undefined }
		],
		// The pipe search is bounded to the longest decodable suffix so nested-label floods stay
		// linear; a zero-padded run is alt text, not a hint.
		['alt|10000x10000', { displayAlt: 'alt', width: 10000, height: 10000, crop: undefined }],
		[
			'alt|000000000001',
			{ displayAlt: 'alt|000000000001', width: undefined, height: undefined, crop: undefined }
		],
		// The crop tail: pan percents, and a zoom only on the three-part form.
		[
			'alt|400x300@30,60',
			{ displayAlt: 'alt', width: 400, height: 300, crop: { x: 30, y: 60, z: 1 } }
		],
		[
			'alt|400x300@0,100,2.5',
			{ displayAlt: 'alt', width: 400, height: 300, crop: { x: 0, y: 100, z: 2.5 } }
		],
		[
			'alt|400x300@50,50,4.00',
			{ displayAlt: 'alt', width: 400, height: 300, crop: { x: 50, y: 50, z: 4 } }
		],
		[
			'alt|10000x10000@100,100,4.00',
			{ displayAlt: 'alt', width: 10000, height: 10000, crop: { x: 100, y: 100, z: 4 } }
		],
		// A malformed tail poisons the whole hint rather than half-applying.
		[
			'alt|400x300@30',
			{ displayAlt: 'alt|400x300@30', width: undefined, height: undefined, crop: undefined }
		],
		[
			'alt|400x300@130,60',
			{ displayAlt: 'alt|400x300@130,60', width: undefined, height: undefined, crop: undefined }
		],
		[
			'alt|400x300@30,60,5',
			{ displayAlt: 'alt|400x300@30,60,5', width: undefined, height: undefined, crop: undefined }
		],
		[
			'alt|400x300@30,60,0.5',
			{ displayAlt: 'alt|400x300@30,60,0.5', width: undefined, height: undefined, crop: undefined }
		],
		[
			'alt|400x300@30,60,1.234',
			{
				displayAlt: 'alt|400x300@30,60,1.234',
				width: undefined,
				height: undefined,
				crop: undefined
			}
		],
		// A crop needs a frame: the width-only form takes no tail.
		[
			'alt|400@30,60',
			{ displayAlt: 'alt|400@30,60', width: undefined, height: undefined, crop: undefined }
		]
	])('parses %s correctly', (input, expected) => {
		expect(parseImageDimensions(input)).toEqual(expected);
	});
});
