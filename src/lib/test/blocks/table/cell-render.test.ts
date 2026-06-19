// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createCellRender } from '../../../components/blocks/table/cell-render';
import type { CstNode } from '../../../core/nodes';
import type { LinkReferenceResolverRef, ResolveLinkUrl } from '../../../editor-keys';

function makeCell(raw: string): CstNode {
	return { kind: 'tableCell', leadingTrivia: '', raw };
}

function mount(
	raw: string,
	linkRef?: LinkReferenceResolverRef,
	resolveLinkUrl: ResolveLinkUrl = (u) => u
) {
	const el = document.createElement('div');
	let node = makeCell(raw);
	const render = createCellRender({
		get el() {
			return el;
		},
		get node() {
			return node;
		},
		get linkRef() {
			return linkRef;
		},
		resolveLinkUrl
	});
	return {
		el,
		render,
		setRaw(next: string) {
			node = makeCell(next);
		}
	};
}

describe('createCellRender', () => {
	it('renders emphasis as a styled <em> with dimmed markers', () => {
		const { el, render } = mount('*x*');
		render.render();
		expect(el.querySelectorAll('em')).toHaveLength(1);
		expect(el.querySelector('em')?.textContent).toBe('x');
		expect(el.querySelectorAll('.md-marker').length).toBeGreaterThanOrEqual(2);
	});

	it('renders a link with href from an inline url', () => {
		const { el, render } = mount('[t](https://example.com)');
		render.render();
		const anchor = el.querySelector('a.md-link-content');
		expect(anchor).not.toBeNull();
		expect(anchor?.getAttribute('href')).toBe('https://example.com');
	});

	it('rewrites a link href through a non-identity resolveLinkUrl', () => {
		// An embedder rewriting a relative href to an absolute one — the seam the
		// paragraph path threads and the cell path dropped.
		const { el, render } = mount('[t](/wiki/page)', undefined, (u) => `https://host${u}`);
		render.render();
		expect(el.querySelector('a.md-link-content')?.getAttribute('href')).toBe(
			'https://host/wiki/page'
		);
	});

	it('preserves textContent for an escaped pipe', () => {
		const { el, render } = mount('b \\| c');
		render.render();
		expect(el.textContent).toBe('b \\| c');
	});

	it('renders an image as alt-text, never a widget', () => {
		const { el, render } = mount('![alt](u)');
		render.render();
		expect(el.querySelector('img')).toBeNull();
		expect(el.querySelector('[data-inline-widget]')).toBeNull();
		expect(el.textContent).toContain('alt');
	});

	it('memoizes: a second render with unchanged raw does not rebuild', () => {
		const { el, render } = mount('plain');
		render.render();
		const firstChild = el.firstChild;
		render.render();
		// Same node identity → no replaceChildren ran.
		expect(el.firstChild).toBe(firstChild);
	});

	it('rebuilds when raw changes', () => {
		const ctx = mount('*x*');
		ctx.render.render();
		expect(ctx.el.querySelector('em')?.textContent).toBe('x');
		ctx.setRaw('**y**');
		ctx.render.render();
		expect(ctx.el.querySelector('em')).toBeNull();
		expect(ctx.el.querySelector('strong')?.textContent).toBe('y');
	});

	it('re-resolves a reference when the LRD signature changes (raw contains "[")', () => {
		let url = 'https://old.com';
		let signature = 'sig-old';
		const linkRef: LinkReferenceResolverRef = {
			get current() {
				return (label: string) => (label === 'r' ? { url } : undefined);
			},
			get signature() {
				return signature;
			}
		};
		const { el, render } = mount('[t][r]', linkRef);
		render.render();
		expect(el.querySelector('a.md-link-content')?.getAttribute('href')).toBe('https://old.com');

		url = 'https://new.com';
		signature = 'sig-new';
		render.render();
		expect(el.querySelector('a.md-link-content')?.getAttribute('href')).toBe('https://new.com');
	});

	it('does not fold signature into the key when raw has no bracket', () => {
		let signature = 'sig-old';
		const linkRef: LinkReferenceResolverRef = {
			get current() {
				return undefined;
			},
			get signature() {
				return signature;
			}
		};
		const { el, render } = mount('plain text', linkRef);
		render.render();
		const child = el.firstChild;
		signature = 'sig-new';
		render.render();
		// No bracket → signature not read into the key → memo holds, no rebuild.
		expect(el.firstChild).toBe(child);
	});
});
