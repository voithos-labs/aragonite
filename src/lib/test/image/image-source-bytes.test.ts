import { describe, it, expect } from 'vitest';
import { buildImageSourceBytes } from '../../components/image/image-source-bytes';

describe('buildImageSourceBytes', () => {
	it('basic image with alt + url', () => {
		expect(buildImageSourceBytes({ alt: 'cat', url: 'cat.png' })).toBe('![cat](cat.png)');
	});

	it('with title (canonical double quotes)', () => {
		expect(buildImageSourceBytes({ alt: 'cat', url: 'cat.png', title: 'Cat' })).toBe(
			'![cat](cat.png "Cat")'
		);
	});

	it('with width-only dimensions', () => {
		expect(buildImageSourceBytes({ alt: 'cat', url: 'cat.png', width: 400 })).toBe(
			'![cat|400](cat.png)'
		);
	});

	it('with width and height dimensions', () => {
		expect(
			buildImageSourceBytes({ alt: 'cat', url: 'cat.png', width: 400, height: 300 })
		).toBe('![cat|400x300](cat.png)');
	});

	it('combines dimensions and title', () => {
		expect(
			buildImageSourceBytes({
				alt: 'cat',
				url: 'cat.png',
				title: 'Cat',
				width: 400
			})
		).toBe('![cat|400](cat.png "Cat")');
	});

	it('empty alt is allowed', () => {
		expect(buildImageSourceBytes({ alt: '', url: 'cat.png' })).toBe('![](cat.png)');
	});

	it('escapes embedded double quotes in title', () => {
		expect(
			buildImageSourceBytes({ alt: 'cat', url: 'cat.png', title: 'A "quoted" cat' })
		).toBe('![cat](cat.png "A \\"quoted\\" cat")');
	});
});
