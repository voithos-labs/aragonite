// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import type { InlineNode } from '../../core/nodes';
import {
	isInlineWidget,
	buildCoreInlineWidget,
	flattenInlineWidgets,
	registerInlineWidgetKind,
	augmentInlineWidgetKind,
	getInlineWidgetEditing,
	__resetInlineWidgetsForTests
} from '../../core/inline/inline-widgets';
import { declarePluginInlineKind } from '../../schema/plugin-kind';

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

describe('flattenInlineWidgets — recursion + document order', () => {
	const img = (start: number, end: number): InlineNode => ({
		kind: 'image',
		start,
		end,
		alt: '',
		url: 'x'
	});
	const txt = (start: number, end: number, text: string): InlineNode => ({
		kind: 'text',
		start,
		end,
		text
	});

	it('returns top-level widgets in document order', () => {
		const nodes = [img(0, 6), txt(6, 7, ' '), img(7, 13)];
		expect(flattenInlineWidgets(nodes, '![](x) ![](x)').map((n) => n.start)).toEqual([0, 7]);
	});

	it('finds an image nested inside a link node', () => {
		// `[![cat][shot]][repo]` — the image is a child of the link node.
		const raw = '[![cat][shot]][repo]';
		const nestedImage = img(1, 13);
		const link: InlineNode = {
			kind: 'link',
			start: 0,
			end: 20,
			url: 'r',
			label: 'repo',
			children: [nestedImage]
		};
		expect(flattenInlineWidgets([link], raw)).toEqual([nestedImage]);
	});

	it('returns nothing for a link with no widget children', () => {
		const raw = '[text](url)';
		const link: InlineNode = {
			kind: 'link',
			start: 0,
			end: 11,
			url: 'url',
			children: [txt(1, 5, 'text')]
		};
		expect(flattenInlineWidgets([link], raw)).toEqual([]);
	});

	it('preserves document order across a top-level widget and a nested one', () => {
		const raw = '![a](x) [![b][r]][q]';
		const topImage = img(0, 7);
		const nestedImage = img(9, 16);
		const link: InlineNode = {
			kind: 'link',
			start: 8,
			end: 20,
			url: 'q',
			label: 'q',
			children: [nestedImage]
		};
		expect(flattenInlineWidgets([topImage, txt(7, 8, ' '), link], raw).map((n) => n.start)).toEqual(
			[0, 9]
		);
	});

	it('treats an atomic widget as a leaf — does not descend into its children', () => {
		// A widget's children belong to the widget; only the widget itself counts.
		const inner = img(1, 5);
		const widgetWithChildren: InlineNode = { ...img(0, 6), children: [inner] };
		expect(flattenInlineWidgets([widgetWithChildren], '![](x)')).toEqual([widgetWithChildren]);
	});
});

describe('getInlineWidgetEditing — per-kind editing policy', () => {
	const mathKind = declarePluginInlineKind('math');
	const spoilerKind = declarePluginInlineKind('spoiler');

	afterEach(__resetInlineWidgetsForTests);

	it('returns the editing policy registered for a plugin widget kind', () => {
		const onSelectedKey = () => true;
		registerInlineWidgetKind(mathKind, {
			isWidget: () => true,
			editing: {
				revealSource: true,
				onSelectedKey
			}
		});
		const policy = getInlineWidgetEditing(mathKind);
		expect(policy?.revealSource).toBe(true);
		expect(policy?.onSelectedKey).toBe(onSelectedKey);
	});

	it('returns undefined for a widget kind registered without an editing policy', () => {
		registerInlineWidgetKind(spoilerKind, { isWidget: () => true });
		expect(getInlineWidgetEditing(spoilerKind)).toBeUndefined();
	});

	it('exposes the built-in editing policies: image carries a base, rawHtml carries none', () => {
		expect(getInlineWidgetEditing('image')).toEqual({});
		expect(getInlineWidgetEditing('rawHtml')).toBeUndefined();
	});
});

describe('augmentInlineWidgetKind — attaching editor behavior to a registration', () => {
	const captionKind = declarePluginInlineKind('caption');

	afterEach(__resetInlineWidgetsForTests);

	it('layers onSelectedKey onto a registered kind without dropping its existing fields', () => {
		registerInlineWidgetKind(captionKind, {
			isWidget: () => true,
			editing: { revealSource: true }
		});
		const onSelectedKey = () => true;
		augmentInlineWidgetKind(captionKind, { onSelectedKey });
		expect(getInlineWidgetEditing(captionKind)).toEqual({
			revealSource: true,
			onSelectedKey
		});
	});

	it('initializes an editing policy when augmenting a kind that had none', () => {
		registerInlineWidgetKind(captionKind, { isWidget: () => true });
		const onSelectedKey = () => true;
		augmentInlineWidgetKind(captionKind, { onSelectedKey });
		expect(getInlineWidgetEditing(captionKind)).toEqual({ onSelectedKey });
	});

	it('throws when the kind was never registered', () => {
		const ghostKind = declarePluginInlineKind('ghost');
		expect(() => augmentInlineWidgetKind(ghostKind, { onSelectedKey: () => true })).toThrow(
			/not registered/
		);
	});
});
