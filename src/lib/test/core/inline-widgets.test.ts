// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { InlineNode } from '../../core/nodes';
import { isInlineWidget, buildCoreInlineWidget } from '../../core/inline/inline-widgets';

describe('isInlineWidget — registry-driven recognition', () => {
	it('treats image as a widget unconditionally', () => {
		const node: InlineNode = { kind: 'image', start: 0, end: 6, url: 'x', alt: '' };
		expect(isInlineWidget(node, '![](x)')).toBe(true);
	});

	it('treats an allowlisted rawHtml tag (<br>) as a widget', () => {
		const raw = '<br>';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		expect(isInlineWidget(node, raw)).toBe(true);
	});

	it('treats a non-allowlisted rawHtml tag (<span>) as not a widget', () => {
		const raw = '<span>';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		expect(isInlineWidget(node, raw)).toBe(false);
	});

	it('treats an HTML comment as not a widget', () => {
		const raw = '<!-- c -->';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		expect(isInlineWidget(node, raw)).toBe(false);
	});

	it.each([
		{ kind: 'text', extra: { text: 'foo' } },
		{ kind: 'emphasis', extra: { children: [] } },
		{ kind: 'link', extra: { children: [], url: 'x' } },
		{ kind: 'autolink', extra: { url: 'x' } },
		{ kind: 'entityReference', extra: { decoded: '©' } }
	] as const)('treats $kind as not a widget', ({ kind, extra }) => {
		const node = { kind, start: 0, end: 3, ...extra } as InlineNode;
		expect(isInlineWidget(node, 'foo')).toBe(false);
	});
});

describe('buildCoreInlineWidget — core-layer builder dispatch', () => {
	it('builds the <br> widget shell for an allowlisted rawHtml node', () => {
		const raw = '<br>';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		const el = buildCoreInlineWidget(node, raw);
		expect(el).not.toBeNull();
		expect(el!.hasAttribute('data-inline-widget')).toBe(true);
		expect(el!.querySelector('br')).not.toBeNull();
	});

	it('returns null for image (built via injected per-render builder, not core)', () => {
		const node: InlineNode = { kind: 'image', start: 0, end: 6, url: 'x', alt: '' };
		expect(buildCoreInlineWidget(node, '![](x)')).toBeNull();
	});

	it('returns null for a non-widget rawHtml tag', () => {
		const raw = '<span>';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		expect(buildCoreInlineWidget(node, raw)).toBeNull();
	});
});
