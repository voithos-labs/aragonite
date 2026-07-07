import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../core/inline';

describe('parseInline — links composing with other constructs', () => {
	it('link with entity reference in text', () => {
		const raw = '[&copy; me](https://example.com)';
		const nodes = parseInline(raw, 0, raw.length);
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
		const entities = links[0].children?.filter((c) => c.kind === 'entityReference');
		expect(entities).toHaveLength(1);
		expect(entities?.[0].decoded).toBe('©');
	});

	it('link with escape in text', () => {
		const raw = '[foo \\*bar\\*](https://example.com)';
		const nodes = parseInline(raw, 0, raw.length);
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		const escapes = links[0].children?.filter((c) => c.kind === 'escape');
		expect(escapes).toHaveLength(2);
		const ems = links[0].children?.filter((c) => c.kind === 'emphasis');
		expect(ems).toHaveLength(0);
	});

	it('image with entity in alt text', () => {
		const raw = '![&copy; logo](logo.png)';
		const nodes = parseInline(raw, 0, raw.length);
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images).toHaveLength(1);
	});

	it('link inside emphasis with entity in link text', () => {
		const raw = '*see [&copy; me](https://example.com) here*';
		const nodes = parseInline(raw, 0, raw.length);
		const ems = nodes.filter((n) => n.kind === 'emphasis');
		expect(ems).toHaveLength(1);
		const links = ems[0].children?.filter((c) => c.kind === 'link');
		expect(links).toHaveLength(1);
	});
});
