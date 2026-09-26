// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { buildAmbientSpan } from '../../ambient/ambient-dom';
import { placeCaretAtRaw } from '../../cursor/widget-offset';

describe('buildAmbientSpan', () => {
	it('string input produces a single text-only span', () => {
		const span = buildAmbientSpan('- ');
		expect(span.className).toBe('md-marker');
		expect(span.getAttribute('contenteditable')).toBe('false');
		expect(span.textContent).toBe('- ');
		expect(span.children.length).toBe(0);
	});

	it('object input with no interactive ranges matches string behavior', () => {
		const span = buildAmbientSpan({ text: '- ' });
		expect(span.textContent).toBe('- ');
		expect(span.children.length).toBe(0);
	});

	it('object input wraps interactive ranges in nested spans', () => {
		const onClick = vi.fn();
		const span = buildAmbientSpan({
			text: '- [x] ',
			interactive: [
				{
					start: 2,
					end: 5,
					className: 'task-checkbox',
					role: 'checkbox',
					ariaChecked: true,
					onClick
				}
			]
		});
		expect(span.textContent).toBe('- [x] ');
		expect(span.children.length).toBe(1);

		const inner = span.children[0] as HTMLElement;
		expect(inner.className).toBe('task-checkbox');
		expect(inner.getAttribute('role')).toBe('checkbox');
		expect(inner.getAttribute('aria-checked')).toBe('true');
		expect(inner.textContent).toBe('[x]');
	});

	it('click on interactive range invokes handler', () => {
		const onClick = vi.fn();
		const span = buildAmbientSpan({
			text: '- [x] ',
			interactive: [{ start: 2, end: 5, className: 'task-checkbox', onClick }]
		});
		const inner = span.children[0] as HTMLElement;
		inner.click();
		expect(onClick).toHaveBeenCalledOnce();
	});

	// Miss-analysis (#254): the range could say only `checkbox` and take only a click, so a
	// footnote's way back had no role, name or key to offer a keyboard user.
	it('a focusable link range carries its name and tab stop, and Enter or Space activates it', () => {
		const onActivate = vi.fn();
		const span = buildAmbientSpan({
			text: '[^a]: ',
			interactive: [
				{
					start: 0,
					end: 4,
					className: 'back',
					role: 'link',
					label: 'Back to reference a',
					focusable: true,
					onClick: () => {},
					onActivate
				}
			]
		});
		const inner = span.children[0] as HTMLElement;
		expect(inner.getAttribute('role')).toBe('link');
		expect(inner.getAttribute('aria-label')).toBe('Back to reference a');
		expect(inner.tabIndex).toBe(0);

		for (const key of ['Enter', ' ']) {
			const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
			inner.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(true);
		}
		inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
		expect(onActivate).toHaveBeenCalledTimes(2);
	});

	it('a range that is not focusable takes no tab stop and no keys', () => {
		const span = buildAmbientSpan({
			text: '[^a]: ',
			interactive: [{ start: 0, end: 4, className: 'back', onClick: () => {} }]
		});
		const inner = span.children[0] as HTMLElement;
		expect(inner.hasAttribute('tabindex')).toBe(false);
		const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		inner.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
	});

	it('text outside interactive ranges renders as text nodes', () => {
		const span = buildAmbientSpan({
			text: 'abXcd',
			interactive: [{ start: 2, end: 3, className: 'mark', onClick: () => {} }]
		});
		expect(span.childNodes.length).toBe(3);
		expect(span.childNodes[0].textContent).toBe('ab');
		expect((span.childNodes[1] as HTMLElement).tagName).toBe('SPAN');
		expect(span.childNodes[1].textContent).toBe('X');
		expect(span.childNodes[2].textContent).toBe('cd');
	});
});

// Miss-analysis (GH #115): the caret at raw 0 preferred the first text node after the span,
// with no test over the traversal, so a widget at the start had its raw bytes silently skipped
// and raw 0 read as that widget's end.
describe('raw 0 behind a marker prefix', () => {
	function mountListBlock(...afterSpan: Node[]): HTMLElement {
		const block = document.createElement('div');
		block.setAttribute('contenteditable', 'true');
		block.append(buildAmbientSpan('- '), ...afterSpan);
		document.body.appendChild(block);
		return block;
	}

	function widget(): HTMLElement {
		const el = document.createElement('span');
		el.setAttribute('data-inline-widget', '');
		el.setAttribute('contenteditable', 'false');
		return el;
	}

	it('puts the caret in the first text node when text opens the content', () => {
		const block = mountListBlock(document.createTextNode('tail'));
		expect(placeCaretAtRaw(block, 0, { clamp: 'exact' })).toBe(true);
		const range = window.getSelection()!.getRangeAt(0);
		expect(range.startContainer.textContent).toBe('tail');
		expect(range.startOffset).toBe(0);
	});

	it('puts the caret at the span boundary when a widget opens the content: its raw is not skippable', () => {
		const block = mountListBlock(widget(), document.createTextNode(' tail'));
		expect(placeCaretAtRaw(block, 0, { clamp: 'exact' })).toBe(true);
		const range = window.getSelection()!.getRangeAt(0);
		expect(range.startContainer).toBe(block);
		expect(range.startOffset).toBe(1);
	});
});
