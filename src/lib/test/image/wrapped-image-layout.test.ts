// @vitest-environment jsdom
/**
 * The ambient-marker pin (`.md-marker[contenteditable=false]` absolutely placed at
 * the image's bottom-left) and the image-only `min-height: 0` are pure CSS, so the
 * only thing that can pin them is the real cascade. These drive the real parser and
 * the real inline renderer into a paragraph under the real editor.css and read
 * computed style back.
 *
 * The class under guard is sibling-path parity across wrapper shapes: `renderInlineNodes`
 * wraps its children in an element for emphasis, strong, strikethrough, and both link
 * forms, which puts the widget one level deeper than a bare `![img](x)` — and
 * `- [![badge](x)](url)` is the commonest list-image shape in real Markdown.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseInline } from '$lib/core/inline';
import { renderInlineNodes, type RenderInlineOptions } from '$lib/core/inline-render';
import { buildImageWidget } from '$lib/components/image/widget-dom';
import { buildAmbientSpan } from '$lib/ambient/ambient-dom';

function widgetOptions(): RenderInlineOptions {
	const brokenUrlCache = new Set<string>();
	return {
		buildImageWidget: (node, raw, imgOpts) =>
			buildImageWidget(node, raw, { ...imgOpts, brokenUrlCache })
	};
}

let editorRoot: HTMLElement;

beforeAll(() => {
	const style = document.createElement('style');
	style.textContent = readFileSync(path.resolve('src/lib/styles/editor.css'), 'utf8');
	document.head.appendChild(style);
	editorRoot = document.createElement('div');
	editorRoot.className = 'editor';
	document.body.appendChild(editorRoot);
});

/** A list-item paragraph: ambient `- ` prefix plus `content` rendered for real. */
function renderListParagraph(content: string): HTMLElement {
	const paragraph = document.createElement('div');
	paragraph.className = 'text-editable-block paragraph-block';
	paragraph.appendChild(buildAmbientSpan('- '));
	paragraph.appendChild(
		renderInlineNodes(parseInline(content, 0, content.length), content, widgetOptions())
	);
	editorRoot.appendChild(paragraph);
	return paragraph;
}

function ambientMarkerOf(paragraph: HTMLElement): Element {
	const marker = paragraph.querySelector(':scope > .md-marker[contenteditable="false"]');
	if (!marker) throw new Error('no ambient marker rendered');
	return marker;
}

// Every wrapper shape `renderInlineNodes` can put between the paragraph and the
// widget. The bare case is the control that already worked; a regression that
// re-tightens the combinator turns the other five red and leaves it green.
const WRAPPED_IMAGES: Array<[string, string]> = [
	['bare (control — already worked)', '![b](i.png)'],
	['emphasis', '*![b](i.png)*'],
	['strong', '**![b](i.png)**'],
	['strikethrough', '~~![b](i.png)~~'],
	['link', '[![b](i.png)](https://x.com)'],
	['link with a blocked scheme', '[![b](i.png)](javascript:alert(1))'],
	['nested wrappers', '[*![b](i.png)*](https://x.com)']
];

describe('image-bearing list paragraph — ambient marker pin', () => {
	it.each(WRAPPED_IMAGES)('pins the marker out of flow for %s', (_label, content) => {
		const paragraph = renderListParagraph(content);
		expect(getComputedStyle(paragraph).position).toBe('relative');
		expect(getComputedStyle(ambientMarkerOf(paragraph)).position).toBe('absolute');
	});

	it('leaves the marker in flow when the paragraph holds no image', () => {
		const paragraph = renderListParagraph('just *text* and [a link](https://x.com)');
		expect(getComputedStyle(paragraph).position).toBe('static');
		expect(getComputedStyle(ambientMarkerOf(paragraph)).position).toBe('static');
	});
});

describe('image-bearing list paragraph — trailing line-box', () => {
	it.each(WRAPPED_IMAGES)('drops the dead line-box for %s', (_label, content) => {
		expect(getComputedStyle(renderListParagraph(content)).minHeight).toBe('0px');
	});

	it('keeps the line-box when the paragraph holds no image', () => {
		expect(getComputedStyle(renderListParagraph('just text')).minHeight).not.toBe('0px');
	});
});

describe('image-bearing link anchor — tooltip hugs the image', () => {
	it.each([
		['direct child', '[![b](i.png)](https://x.com "t")'],
		['nested in emphasis', '[*![b](i.png)*](https://x.com "t")']
	])('shrink-wraps the anchor when the image is a %s', (_label, content) => {
		const anchor = renderListParagraph(content).querySelector('a.md-link-content');
		expect(anchor).not.toBeNull();
		expect(getComputedStyle(anchor!).display).toBe('inline-block');
	});

	it('leaves a text-only anchor inline', () => {
		const anchor = renderListParagraph('[text](https://x.com "t")').querySelector(
			'a.md-link-content'
		);
		expect(getComputedStyle(anchor!).display).toBe('inline');
	});
});
