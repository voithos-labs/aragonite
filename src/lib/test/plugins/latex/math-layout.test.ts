import { describe, it, expect } from 'vitest';
import { resolveDefaultLayout } from '$lib/plugins/latex/math-layout';

// The host's choice reaches the block through two doors — this editor's plugin options, then
// the factory default — and an unknown value falls through rather than breaking the block.
describe('resolveDefaultLayout', () => {
	it('prefers the editor instance options over the factory default', () => {
		expect(resolveDefaultLayout({ blockLayout: 'stacked' }, 'source')).toBe('stacked');
	});

	it('falls back to the factory default when the instance declares none', () => {
		expect(resolveDefaultLayout(undefined, 'source')).toBe('source');
		expect(resolveDefaultLayout({}, 'stacked')).toBe('stacked');
	});

	it('ignores an unknown value and lands on split by default', () => {
		expect(resolveDefaultLayout({ blockLayout: 'sideways' })).toBe('split');
		expect(resolveDefaultLayout({ blockLayout: 'sideways' }, 'stacked')).toBe('stacked');
	});
});
