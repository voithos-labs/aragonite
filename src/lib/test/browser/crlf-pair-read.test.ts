// @vitest-environment jsdom
// Miss-analysis: every caret-read test ran on LF text, and Chromium never stops between `\r` and `\n`.
import { describe, it, expect, afterEach } from 'vitest';
import { domTextOffsetAtNode, rawOffsetAt } from '../../browser/offsets';

const LINE = 'abc\r\nAfter\r\n';

/** Every offset of `text` that sits after a `\r` its `\n` follows reads one earlier. */
function expectedRead(text: string, offset: number): number {
	return text[offset - 1] === '\r' && text[offset] === '\n' ? offset - 1 : offset;
}

function mount(...nodes: Node[]): HTMLElement {
	const el = document.createElement('div');
	el.append(...nodes);
	document.body.appendChild(el);
	return el;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('a DOM position inside a CRLF pair reads before the pair', () => {
	it('every offset of one text node', () => {
		const text = document.createTextNode(LINE);
		const el = mount(text);
		for (let offset = 0; offset <= LINE.length; offset++) {
			expect(domTextOffsetAtNode(el, text, offset), `offset ${offset}`).toBe(
				expectedRead(LINE, offset)
			);
		}
	});

	it('every offset when the pair straddles two text nodes in different spans', () => {
		const head = document.createTextNode('abc\r');
		const tail = document.createTextNode('\nAfter');
		const first = document.createElement('span');
		first.append(head);
		const second = document.createElement('span');
		second.append(tail);
		const el = mount(first, second);
		const joined = 'abc\r\nAfter';
		for (let offset = 0; offset <= head.length; offset++) {
			expect(domTextOffsetAtNode(el, head, offset), `head ${offset}`).toBe(
				expectedRead(joined, offset)
			);
		}
		for (let offset = 0; offset <= tail.length; offset++) {
			const at = head.length + offset;
			expect(domTextOffsetAtNode(el, tail, offset), `tail ${offset}`).toBe(
				expectedRead(joined, at)
			);
		}
	});

	it('an element-level position between the two halves', () => {
		const el = mount(document.createTextNode('abc\r'), document.createTextNode('\nAfter'));
		expect(domTextOffsetAtNode(el, el, 1)).toBe(3);
	});

	it('a lone `\\r` or a lone `\\n` reads where it is', () => {
		const text = document.createTextNode('a\rb\nc\n\rd');
		const el = mount(text);
		for (let offset = 0; offset <= text.length; offset++) {
			expect(domTextOffsetAtNode(el, text, offset), `offset ${offset}`).toBe(offset);
		}
	});

	it('the raw read rounds the same way, past a marker prefix', () => {
		const prefix = document.createElement('span');
		prefix.className = 'md-marker';
		prefix.setAttribute('contenteditable', 'false');
		prefix.textContent = '- ';
		const text = document.createTextNode('abc\r\nAfter');
		const el = mount(prefix, text);
		expect(rawOffsetAt(el, text, 4)).toBe(3);
		expect(rawOffsetAt(el, text, 5)).toBe(5);
	});
});
