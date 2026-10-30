// @vitest-environment jsdom
/**
 * A picture lays out inline in its line whatever inline wrapper holds it, so a letter typed beside
 * it lands on that line; the layout is pure CSS, so this checks every wrapper shape the render makes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseInline } from '#lib/core/inline/index.js';
import { renderInlineNodes, type RenderInlineOptions } from '#lib/core/inline-render.js';
import { buildImageWidget } from '#lib/components/image/widget-dom.js';
import { buildAmbientSpan } from '#lib/components/blocks/marker-prefix.js';
import { renderOptions } from '../harness/fixture-grammar';

function widgetOptions(): RenderInlineOptions {
	const brokenUrlCache = new Set<string>();
	return renderOptions({
		buildImageWidget: (node, raw, imgOpts) =>
			buildImageWidget(node, raw, { ...imgOpts, brokenUrlCache })
	});
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

/** A list-item paragraph: the `- ` marker prefix plus `content` rendered for real. */
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

// Every wrapper shape `renderInlineNodes` can put between the paragraph and the widget.
const WRAPPED_IMAGES: Array<[string, string]> = [
	['bare', '![b](i.png)'],
	['emphasis', '*![b](i.png)*'],
	['strong', '**![b](i.png)**'],
	['strikethrough', '~~![b](i.png)~~'],
	['link', '[![b](i.png)](https://x.com "t")'],
	['link with a blocked scheme', '[![b](i.png)](javascript:alert(1))'],
	['nested wrappers', '[*![b](i.png)*](https://x.com)']
];

describe('a picture keeps its line in every wrapper', () => {
	it.each(WRAPPED_IMAGES)('%s', (_label, content) => {
		const paragraph = renderListParagraph(content);
		const widget = paragraph.querySelector<HTMLElement>('[data-image-widget]')!;
		expect(getComputedStyle(widget).display).toBe('inline-block');
		expect(getComputedStyle(widget).verticalAlign).toBe('bottom');
		for (let el = widget.parentElement; el && el !== paragraph; el = el.parentElement) {
			expect(getComputedStyle(el).display, el.className).toMatch(/^inline/);
		}
	});
});
