// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import { createCellRender } from '../../../components/blocks/table/cell-render';
import {
	INLINE_PRIORITIES,
	registerInlineSyntax,
	__resetInlineSyntaxForTests
} from '../../../core/inline/scan/plugin-syntax';
import type { CstNode } from '../../../core/nodes';
import type { LinkReferenceResolverRef, ResolveLinkUrl } from '../../../editor-keys';
import type { IndexedDecoration } from '../../../decorations/buckets';
import type { ReplaceDecoration, WidgetDecoration } from '../../../decorations/types';
import { defaultGrammarView } from '$lib/schema/block-openers';

type Island = IndexedDecoration<WidgetDecoration | ReplaceDecoration>;

function makeCell(raw: string): CstNode {
	return { kind: 'tableCell', leadingTrivia: '', raw };
}

const replaceIsland = (start: number, end: number, buildDom?: () => HTMLElement): Island => ({
	index: 0,
	dec: {
		type: 'replace',
		path: [0, 0, 0],
		start,
		end,
		class: 'fold-island',
		widget: buildDom ? { buildDom } : undefined
	}
});

function registerEmbedRung(): void {
	registerInlineSyntax(
		'!',
		(raw, pos, end) => {
			if (!raw.startsWith('![[', pos)) return null;
			const close = raw.indexOf(']]', pos + 3);
			if (close < 0 || close + 2 > end) return null;
			const target = raw.slice(pos + 3, close);
			return { kind: 'image', start: pos, end: close + 2, children: [], alt: target, url: target };
		},
		{ prefix: '![[', priority: INLINE_PRIORITIES.prefixOverride }
	);
}

function mount(
	raw: string,
	linkRef?: LinkReferenceResolverRef,
	resolveLinkUrl: ResolveLinkUrl = (u) => u
) {
	const el = document.createElement('div');
	let node = makeCell(raw);
	let islands: Island[] = [];
	const render = createCellRender({
		get el() {
			return el;
		},
		get node() {
			return node;
		},
		grammar: defaultGrammarView,
		get linkRef() {
			return linkRef;
		},
		resolveLinkUrl,
		get presentationMode() {
			return 'source' as const;
		},
		getDocument: () => undefined,
		get islands() {
			return islands;
		}
	});
	return {
		el,
		render,
		setRaw(next: string) {
			node = makeCell(next);
		},
		setIslands(next: Island[]) {
			islands = next;
		}
	};
}

afterEach(() => __resetInlineSyntaxForTests());

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
		// An embedder rewriting a relative href to an absolute one, which the paragraph
		// path passes through and the cell path must too.
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
		expect(el.textContent).toBe('![alt](u)');
		// The split is what a reading-mode collapse leaves behind: markers go, alt stays.
		expect([...el.querySelectorAll('.md-marker')].map((m) => m.textContent)).toEqual([
			'![',
			'](u)'
		]);
	});

	// A plugin's `![[…]]` handler makes a built-in image whose alt names the target, so the
	// cell's alt-only path meets a node whose markers are not the two GFM ones.
	it('renders a plugin-created image as its own source bytes', () => {
		registerEmbedRung();
		const { el, render } = mount('![[cat.png]]');
		render.render();
		expect(el.textContent).toBe('![[cat.png]]');
	});

	// A link with no text renders as two marker spans and nothing else, which a marker-hiding
	// mode would paint as an empty cell with no caret position.
	// Miss-analysis: the cell is the third place marker spans are created, and the two prose
	// blocks carried the content-empty rule while this one was never asked the question.
	it('marks a cell whose whole content is chrome, and drops the mark when text arrives', () => {
		const ctx = mount('[](u)');
		ctx.render.render();
		expect(ctx.el.hasAttribute('data-content-empty')).toBe(true);

		ctx.setRaw('[t](u)');
		ctx.render.render();
		expect(ctx.el.hasAttribute('data-content-empty')).toBe(false);
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

	it('keys on the compact epoch, not the signature string, when the resolver supplies one', () => {
		let url = 'https://old.com';
		let signature = 'sig-1';
		let epoch = 1;
		const linkRef: LinkReferenceResolverRef = {
			get current() {
				return (label: string) => (label === 'r' ? { url } : undefined);
			},
			get signature() {
				return signature;
			},
			get epoch() {
				return epoch;
			}
		};
		const { el, render } = mount('[t][r]', linkRef);
		render.render();
		expect(el.querySelector('a.md-link-content')?.getAttribute('href')).toBe('https://old.com');

		// The key assertion: with a token supplied the signature string is not in the key, so a
		// change to the string alone, which cannot happen in practice, does not re-render.
		url = 'https://new.com';
		signature = 'sig-2';
		render.render();
		expect(el.querySelector('a.md-link-content')?.getAttribute('href')).toBe('https://old.com');

		epoch = 2;
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

	// ── Decorations (the same as the prose render, with no marker prefix) ──────

	it('applies a replace decoration in a cell, covering the raw range', () => {
		const { el, render, setIslands } = mount('a SECRET b');
		setIslands([
			replaceIsland(2, 8, () => Object.assign(document.createElement('span'), { textContent: '…' }))
		]);
		render.render();
		const island = el.querySelector('[data-decoration-island]');
		expect(island).not.toBeNull();
		expect(island?.getAttribute('data-source-start')).toBe('2');
		expect(island?.getAttribute('data-source-end')).toBe('8');
		// The covered bytes leave the DOM text; the decoration stands for them.
		expect(el.textContent).not.toContain('SECRET');
	});

	it('a signature change rebuilds; an equal signature does not', () => {
		const { el, render, setIslands } = mount('a SECRET b');
		setIslands([replaceIsland(2, 8)]);
		render.render();
		const island = el.querySelector('[data-decoration-island]');
		setIslands([replaceIsland(2, 8)]); // fresh objects, equal signature
		render.render();
		expect(el.querySelector('[data-decoration-island]')).toBe(island);
		setIslands([replaceIsland(0, 1)]); // moved → new signature
		render.render();
		expect(el.querySelector('[data-decoration-island]')).not.toBe(island);
	});
});
