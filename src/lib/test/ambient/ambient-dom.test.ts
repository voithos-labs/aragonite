// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { buildAmbientSpan } from '../../ambient/ambient-dom';

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
