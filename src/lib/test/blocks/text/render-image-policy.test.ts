// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { createTextRender, type TextRenderDeps } from '$lib/components/blocks/text/text-render';
import type { ImageLoadPolicy } from '$lib/core/inline-render';
import type { CstNode } from '$lib/core/nodes';

function paragraphNode(source: string): CstNode {
	const node = parse(source).children[0];
	if (!node) throw new Error('expected a block node');
	return node;
}

function makeDeps(node: CstNode, el: HTMLElement, initialPolicy: ImageLoadPolicy) {
	let policy = initialPolicy;
	const deps: TextRenderDeps = {
		get el() {
			return el;
		},
		get node() {
			return node;
		},
		get ambientPrefix() {
			return '';
		},
		get ambientPrefixText() {
			return '';
		},
		getDisplayText: () => node.raw,
		resolveImageUrl: (u) => u,
		resolveLinkUrl: (u) => u,
		get imageLoadPolicy() {
			return policy;
		},
		get linkResolver() {
			return undefined;
		},
		get linkSignature() {
			return '';
		},
		get islands() {
			return [];
		},
		get presentationMode() {
			return 'source' as const;
		},
		brokenUrlCache: new Set<string>()
	};
	return {
		deps,
		setPolicy(next: ImageLoadPolicy) {
			policy = next;
		}
	};
}

describe('text-render image-load-policy memo key', () => {
	it('repaints an image block when imageLoadPolicy flips at runtime', () => {
		const el = document.createElement('div');
		const node = paragraphNode('![cat](/x.png)\n');
		const { deps, setPolicy } = makeDeps(node, el, 'auto');
		const render = createTextRender(deps);

		render.render();
		const widget = () => el.querySelector('.md-image-widget');
		expect(widget()).not.toBeNull();
		expect(widget()!.classList.contains('md-image-placeholder')).toBe(false);

		setPolicy('placeholder');
		render.render();
		expect(widget()!.classList.contains('md-image-placeholder')).toBe(true);

		setPolicy('auto');
		render.render();
		expect(widget()!.classList.contains('md-image-placeholder')).toBe(false);
	});

	it('does not rebuild an image-free block when imageLoadPolicy flips', () => {
		const el = document.createElement('div');
		const node = paragraphNode('hello\n');
		const { deps, setPolicy } = makeDeps(node, el, 'auto');
		const render = createTextRender(deps);

		render.render();
		const firstChild = el.firstChild;
		expect(firstChild).not.toBeNull();

		setPolicy('placeholder');
		render.render();

		// Image-free blocks must not subscribe to the policy: the early-return holds,
		// so the DOM is untouched and the child node keeps its identity.
		expect(el.firstChild).toBe(firstChild);
	});
});
