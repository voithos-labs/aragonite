// Image widget contributes its raw bytes via data-source-start / data-source-end
// — `cursor/widget-offset.ts` reads them. textContent stays empty so prose
// `textContent === ambientPrefix + raw` still holds.

import type { InlineNode } from '../../core/nodes';

export interface BuildImageWidgetOpts {
	resolveImageUrl: (rawUrl: string) => string;
	paragraphPath: number[];
}

export function buildImageWidget(
	node: InlineNode,
	_raw: string,
	opts: BuildImageWidgetOpts
): HTMLSpanElement {
	const widget = document.createElement('span');
	widget.className = 'md-image-widget';
	// `data-inline-widget` is the shared atomic-widget marker (cursor walker,
	// selection painter, raw reader); `data-image-widget` is image-specific.
	widget.dataset.inlineWidget = '';
	widget.dataset.imageWidget = '';
	widget.dataset.sourceStart = String(node.start);
	widget.dataset.sourceEnd = String(node.end);
	widget.dataset.paragraphPath = opts.paragraphPath.join(',');
	widget.setAttribute('contenteditable', 'false');

	widget.addEventListener('pointerdown', (e) => {
		e.stopPropagation();
		const event = new CustomEvent('image-widget-select', {
			bubbles: true,
			detail: { paragraphPath: [...opts.paragraphPath], sourceStart: node.start }
		});
		widget.dispatchEvent(event);
	});

	const img = document.createElement('img');
	img.alt = node.alt ?? '';
	img.src = safeResolve(opts.resolveImageUrl, node.url ?? '');
	if (node.title) img.title = node.title;
	if (node.width !== undefined) img.setAttribute('width', String(node.width));
	if (node.height !== undefined) img.setAttribute('height', String(node.height));
	img.addEventListener('error', () => {
		widget.classList.add('md-image-broken');
	});
	widget.appendChild(img);

	return widget;
}

function safeResolve(resolver: (u: string) => string, url: string): string {
	try {
		const out = resolver(url);
		if (typeof out !== 'string') {
			if (import.meta.env.DEV) {
				console.warn('[image-widget] resolveImageUrl returned non-string; falling back to raw URL');
			}
			return url;
		}
		return out;
	} catch (e) {
		if (import.meta.env.DEV) {
			console.warn('[image-widget] resolveImageUrl threw:', e);
		}
		return url;
	}
}
