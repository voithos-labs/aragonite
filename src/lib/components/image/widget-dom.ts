// Hidden source span keeps `textContent === ambientPrefix + raw` intact, so
// selection/caret math against raw still works without an offset translation
// primitive (deferred to 0.7's entity-reference fix).

import type { InlineNode } from '../../core/nodes';

export interface BuildImageWidgetOpts {
	resolveImageUrl: (rawUrl: string) => string;
	paragraphPath: number[];
}

export function buildImageWidget(
	node: InlineNode,
	raw: string,
	opts: BuildImageWidgetOpts
): HTMLSpanElement {
	const widget = document.createElement('span');
	widget.className = 'md-image-widget';
	widget.dataset.imageWidget = '';
	widget.dataset.sourceStart = String(node.start);
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

	const sourceSpan = document.createElement('span');
	sourceSpan.className = 'md-image-source';
	sourceSpan.textContent = raw.slice(node.start, node.end);
	widget.appendChild(sourceSpan);

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
