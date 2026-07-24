import { describe, it, expect } from 'vitest';
import {
	buildImageSourceBytes,
	imageFieldsFromInline
} from '../../components/image/image-source-bytes';
import { parseInline } from '../../core/inline';

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
		expect(buildImageSourceBytes({ alt: 'cat', url: 'cat.png', width: 400, height: 300 })).toBe(
			'![cat|400x300](cat.png)'
		);
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
		expect(buildImageSourceBytes({ alt: 'cat', url: 'cat.png', title: 'A "quoted" cat' })).toBe(
			'![cat](cat.png "A \\"quoted\\" cat")'
		);
	});
});

describe('buildImageSourceBytes — reference form (label preserved)', () => {
	it('emits the reference form when a label is present', () => {
		expect(buildImageSourceBytes({ alt: 'cat', url: 'resolved.png', label: 'ref' })).toBe(
			'![cat][ref]'
		);
	});

	it('keeps the dimension hint in the alt for the reference form', () => {
		expect(
			buildImageSourceBytes({ alt: 'cat', url: 'resolved.png', width: 400, label: 'ref' })
		).toBe('![cat|400][ref]');
	});

	it('keeps width × height in the alt for the reference form', () => {
		expect(
			buildImageSourceBytes({
				alt: 'cat',
				url: 'resolved.png',
				width: 400,
				height: 300,
				label: 'ref'
			})
		).toBe('![cat|400x300][ref]');
	});

	it('does NOT write url or title in the reference form (they live in the LRD)', () => {
		const out = buildImageSourceBytes({
			alt: 'cat',
			url: 'resolved.png',
			title: 'Some title',
			width: 200,
			label: 'shot'
		});
		expect(out).toBe('![cat|200][shot]');
		expect(out).not.toContain('resolved.png');
		expect(out).not.toContain('Some title');
	});

	it('escapes brackets in the alt of the reference form', () => {
		expect(buildImageSourceBytes({ alt: 'a]b', url: 'u', label: 'ref' })).toBe('![a\\]b][ref]');
	});

	it('falls back to the inline form when no label is present', () => {
		expect(buildImageSourceBytes({ alt: 'cat', url: 'cat.png', width: 400 })).toBe(
			'![cat|400](cat.png)'
		);
	});
});

describe('buildImageSourceBytes — output re-parses as an image', () => {
	const parsesToOneImage = (built: string): boolean => {
		const nodes = parseInline(built, 0, built.length);
		return nodes.length === 1 && nodes[0].kind === 'image';
	};

	it.each([
		['close bracket in alt', { alt: 'a]b', url: 'u' }],
		['open bracket in alt', { alt: 'a[b', url: 'u' }],
		['backslash in alt', { alt: 'a\\b', url: 'u' }],
		['space in url (local path)', { alt: 'a', url: 'C:/My Photos/x.png' }],
		['close paren in url', { alt: 'a', url: 'http://x/(y)' }],
		['single quote in url', { alt: 'a', url: "http://x/'y" }]
	])('%s survives the scanner instead of degrading to text', (_label, fields) => {
		expect(parsesToOneImage(buildImageSourceBytes(fields))).toBe(true);
	});

	it('URL encoding is idempotent (no double-encode on rebuild)', () => {
		expect(buildImageSourceBytes({ alt: 'a', url: 'x%20y' })).toBe(
			buildImageSourceBytes({ alt: 'a', url: 'x y' })
		);
	});

	// The `alt` an image node carries is RAW label bytes (the scanner slices the
	// label without unescaping), unlike `title`/`url`, which arrive spec-processed.
	// A blanket re-escape therefore doubled every backslash on each commit — a
	// drag-resize alone grew `![C:\path]` to `![C:\\path]` to `![C:\\\\path]`.
	const rebuildSpan = (source: string): string => {
		const image = parseInline(source, 0, source.length)[0];
		return buildImageSourceBytes(imageFieldsFromInline(image));
	};

	it.each([
		['a Windows path in the alt', '![C:\\path](x.png)'],
		['an already-escaped close bracket', '![a\\]b](x.png)'],
		['an already-escaped backslash', '![a\\\\b](x.png)'],
		['a trailing backslash', '![a\\\\](x.png)']
	])('%s rebuilds byte-for-byte and stays put on a second rebuild', (_label, source) => {
		expect(rebuildSpan(source)).toBe(source);
		expect(rebuildSpan(rebuildSpan(source))).toBe(source);
	});

	it('repeated resizes do not grow the alt', () => {
		let bytes = '![C:\\path](x.png)';
		for (let round = 0; round < 3; round++) {
			const image = parseInline(bytes, 0, bytes.length)[0];
			bytes = buildImageSourceBytes({ ...imageFieldsFromInline(image), width: 400 });
		}
		expect(bytes).toBe('![C:\\path|400](x.png)');
	});

	it('still escapes a bare bracket the user typed into the alt', () => {
		expect(buildImageSourceBytes({ alt: 'a]b[c', url: 'u' })).toBe('![a\\]b\\[c](u)');
	});

	it('encodes both parens so the destination never carries an unbalanced pair', () => {
		// Encoding only `)` leaves a bare `(` — CommonMark destinations include
		// parens "only if they are backslash-escaped or part of a balanced pair",
		// so the spec parser rejects the rebuilt image.
		expect(buildImageSourceBytes({ alt: 'a', url: 'http://x/(y)' })).toBe('![a](http://x/%28y%29)');
	});
});
