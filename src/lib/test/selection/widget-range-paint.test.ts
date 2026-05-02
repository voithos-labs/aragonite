// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installWidgetRangePainter } from '../../selection/widget-range-paint';

describe('installWidgetRangePainter', () => {
	let editorRoot: HTMLElement;
	let para: HTMLElement;
	let leadText: Text;
	let widgetA: HTMLElement;
	let midText: Text;
	let widgetB: HTMLElement;
	let trailText: Text;
	let abort: AbortController;

	beforeEach(() => {
		editorRoot = document.createElement('div');
		para = document.createElement('p');
		leadText = document.createTextNode('lead ');
		widgetA = document.createElement('span');
		widgetA.setAttribute('data-image-widget', '');
		widgetA.setAttribute('data-inline-widget', '');
		widgetA.setAttribute('contenteditable', 'false');
		midText = document.createTextNode(' mid ');
		widgetB = document.createElement('span');
		widgetB.setAttribute('data-image-widget', '');
		widgetB.setAttribute('data-inline-widget', '');
		widgetB.setAttribute('contenteditable', 'false');
		trailText = document.createTextNode(' trail');

		para.append(leadText, widgetA, midText, widgetB, trailText);
		editorRoot.appendChild(para);
		document.body.appendChild(editorRoot);

		abort = new AbortController();
	});

	afterEach(() => {
		abort.abort();
		editorRoot.remove();
	});

	function install(opts?: {
		isCustomRendered?: boolean;
		isWidgetSelected?: boolean;
	}): void {
		installWidgetRangePainter({
			editorRoot,
			getSelectionIsCustomRendered: () => opts?.isCustomRendered ?? false,
			getWidgetIsSelected: () => opts?.isWidgetSelected ?? false,
			lifetime: abort.signal
		});
	}

	function setRange(startNode: Node, startOffset: number, endNode: Node, endOffset: number): void {
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		const r = document.createRange();
		r.setStart(startNode, startOffset);
		r.setEnd(endNode, endOffset);
		sel.addRange(r);
		document.dispatchEvent(new Event('selectionchange'));
	}

	it('adds md-widget-selected only to widgets the range intersects', () => {
		install();
		// Range spans lead-text into mid-text — covers widgetA, not widgetB.
		setRange(leadText, 0, midText, 2);
		expect(widgetA.classList.contains('md-widget-selected')).toBe(true);
		expect(widgetB.classList.contains('md-widget-selected')).toBe(false);
	});

	it('removes the class when selection collapses', () => {
		install();
		setRange(leadText, 0, midText, 2);
		expect(widgetA.classList.contains('md-widget-selected')).toBe(true);

		const sel = window.getSelection()!;
		sel.removeAllRanges();
		document.dispatchEvent(new Event('selectionchange'));

		expect(widgetA.classList.contains('md-widget-selected')).toBe(false);
	});

	it('clears classes when isCustomRendered is true (overlay owns painting)', () => {
		let isCustomRendered = false;
		installWidgetRangePainter({
			editorRoot,
			getSelectionIsCustomRendered: () => isCustomRendered,
			getWidgetIsSelected: () => false,
			lifetime: abort.signal
		});

		setRange(leadText, 0, trailText, 6);
		expect(widgetA.classList.contains('md-widget-selected')).toBe(true);
		expect(widgetB.classList.contains('md-widget-selected')).toBe(true);

		isCustomRendered = true;
		document.dispatchEvent(new Event('selectionchange'));

		expect(widgetA.classList.contains('md-widget-selected')).toBe(false);
		expect(widgetB.classList.contains('md-widget-selected')).toBe(false);
	});

	it('clears classes when a widget is selected (popover owns the visual)', () => {
		let isWidgetSelected = false;
		installWidgetRangePainter({
			editorRoot,
			getSelectionIsCustomRendered: () => false,
			getWidgetIsSelected: () => isWidgetSelected,
			lifetime: abort.signal
		});

		setRange(leadText, 0, midText, 2);
		expect(widgetA.classList.contains('md-widget-selected')).toBe(true);

		isWidgetSelected = true;
		document.dispatchEvent(new Event('selectionchange'));

		expect(widgetA.classList.contains('md-widget-selected')).toBe(false);
	});

	it('ignores selections outside the editor root', () => {
		install();
		const outside = document.createElement('p');
		outside.textContent = 'outside';
		document.body.appendChild(outside);
		try {
			setRange(outside.firstChild!, 0, outside.firstChild!, 4);
			expect(widgetA.classList.contains('md-widget-selected')).toBe(false);
			expect(widgetB.classList.contains('md-widget-selected')).toBe(false);
		} finally {
			outside.remove();
		}
	});

	it('lifetime abort removes the listener and clears classes', () => {
		install();
		setRange(leadText, 0, midText, 2);
		expect(widgetA.classList.contains('md-widget-selected')).toBe(true);

		abort.abort();
		expect(widgetA.classList.contains('md-widget-selected')).toBe(false);

		// Subsequent selectionchange is a no-op.
		setRange(midText, 0, trailText, 4);
		expect(widgetB.classList.contains('md-widget-selected')).toBe(false);
	});
});
