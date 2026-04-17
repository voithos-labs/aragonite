// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mapHljsClass, walkHljsNodes } from '../../components/blocks/code/code-renderer';

describe('mapHljsClass', () => {
	it('maps core hljs classes to code-tok classes', () => {
		expect(mapHljsClass('hljs-keyword')).toBe('code-tok-keyword');
		expect(mapHljsClass('hljs-string')).toBe('code-tok-string');
		expect(mapHljsClass('hljs-number')).toBe('code-tok-number');
		expect(mapHljsClass('hljs-comment')).toBe('code-tok-comment');
		expect(mapHljsClass('hljs-type')).toBe('code-tok-type');
		expect(mapHljsClass('hljs-built_in')).toBe('code-tok-function');
		expect(mapHljsClass('hljs-function')).toBe('code-tok-function');
		expect(mapHljsClass('hljs-title')).toBe('code-tok-function');
		expect(mapHljsClass('hljs-variable')).toBe('code-tok-variable');
		expect(mapHljsClass('hljs-operator')).toBe('code-tok-operator');
		expect(mapHljsClass('hljs-punctuation')).toBe('code-tok-punctuation');
		expect(mapHljsClass('hljs-meta')).toBe('code-tok-meta');
		expect(mapHljsClass('hljs-literal')).toBe('code-tok-literal');
		expect(mapHljsClass('hljs-attr')).toBe('code-tok-attr');
	});

	it('maps selector-* classes correctly', () => {
		expect(mapHljsClass('hljs-selector-tag')).toBe('code-tok-type');
		expect(mapHljsClass('hljs-selector-id')).toBe('code-tok-attr');
		expect(mapHljsClass('hljs-selector-class')).toBe('code-tok-attr');
	});

	it('maps diff and markdown-ish classes', () => {
		expect(mapHljsClass('hljs-addition')).toBe('code-tok-added');
		expect(mapHljsClass('hljs-deletion')).toBe('code-tok-removed');
		expect(mapHljsClass('hljs-section')).toBe('code-tok-heading');
	});

	it('returns code-tok-unknown for classes not in the map', () => {
		expect(mapHljsClass('hljs-quasi-arbitrary')).toBe('code-tok-unknown');
		expect(mapHljsClass('hljs-xyz')).toBe('code-tok-unknown');
	});

	it('returns code-tok-unknown for non-hljs class names', () => {
		expect(mapHljsClass('random-class')).toBe('code-tok-unknown');
		expect(mapHljsClass('')).toBe('code-tok-unknown');
	});
});

describe('walkHljsNodes', () => {
	function parseHljsHtml(html: string): DocumentFragment {
		const template = document.createElement('template');
		template.innerHTML = html;
		return template.content;
	}

	function walk(html: string): DocumentFragment {
		const target = document.createDocumentFragment();
		walkHljsNodes(parseHljsHtml(html), target);
		return target;
	}

	it('passes through plain text unchanged', () => {
		const frag = walk('hello world');
		expect(frag.textContent).toBe('hello world');
		expect(frag.childNodes.length).toBe(1);
		expect(frag.firstChild?.nodeType).toBe(Node.TEXT_NODE);
	});

	it('wraps a single hljs-* span', () => {
		const frag = walk('<span class="hljs-keyword">const</span>');
		expect(frag.textContent).toBe('const');
		const span = frag.firstChild as HTMLElement;
		expect(span.nodeType).toBe(Node.ELEMENT_NODE);
		expect(span.className).toBe('code-tok-keyword');
		expect(span.textContent).toBe('const');
	});

	it('preserves nested spans recursively', () => {
		const frag = walk(
			'<span class="hljs-string">"outer <span class="hljs-subst">inner</span> more"</span>'
		);
		expect(frag.textContent).toBe('"outer inner more"');
		const outer = frag.firstChild as HTMLElement;
		expect(outer.className).toBe('code-tok-string');
		expect(outer.querySelector('.code-tok-subst')?.textContent).toBe('inner');
	});

	it('preserves newlines as text nodes, not <br>', () => {
		const frag = walk('line1\nline2');
		expect(frag.textContent).toBe('line1\nline2');
		expect(frag.querySelector('br')).toBeNull();
	});

	it('preserves the textContent invariant across mixed text and spans', () => {
		const input = '<span class="hljs-keyword">const</span> x = <span class="hljs-number">42</span>;';
		const frag = walk(input);
		expect(frag.textContent).toBe('const x = 42;');
	});

	it('handles empty input', () => {
		const frag = walk('');
		expect(frag.textContent).toBe('');
		expect(frag.childNodes.length).toBe(0);
	});
});

