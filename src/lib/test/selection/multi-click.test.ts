// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
	granularityForClickCount,
	installMultiClickSelect,
	wordSpanAt
} from '$lib/selection/multi-click';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { maskedWalkText } from '$lib/cursor/widget-offset';

const span = (text: string, offset: number) => {
	const s = wordSpanAt(text, offset);
	return s && text.slice(s.start, s.end);
};

describe('wordSpanAt: the segment a press at an offset takes', () => {
	it('takes the word around an interior offset', () => {
		expect(span('hello world', 2)).toBe('hello');
		expect(span('hello world', 8)).toBe('world');
	});

	it('at a boundary prefers the word ending there over the space starting there', () => {
		expect(span('hello world', 5)).toBe('hello');
	});

	it('at a boundary after a space takes the word starting there', () => {
		expect(span('hello world', 6)).toBe('world');
	});

	it('at punctuation takes the word beside it, never the mark', () => {
		expect(span('foo,bar', 3)).toBe('foo');
		expect(span('foo,bar', 4)).toBe('bar');
	});

	it('inside whitespace takes the whitespace run, as the browser would', () => {
		expect(span('a  b', 2)).toBe('  ');
	});

	it('keeps apostrophes, underscores and non-ASCII letters inside the word', () => {
		expect(span("it's fine", 1)).toBe("it's");
		expect(span('foo_bar baz', 1)).toBe('foo_bar');
		expect(span('über café', 6)).toBe('café');
	});

	it('segments CJK by dictionary word, not by run', () => {
		expect(span('日本語 テキスト', 1)).toBe('日本語');
	});

	it('clamps an offset past the end onto the last segment', () => {
		expect(span('hello', 9)).toBe('hello');
	});

	it('answers null on empty text', () => {
		expect(wordSpanAt('', 0)).toBeNull();
	});
});

describe('maskedWalkText: what the word rule reads', () => {
	it('blanks marker chrome and widgets to spaces at the walk offsets', () => {
		const p = document.createElement('p');
		p.innerHTML =
			'<span class="md-marker">**</span>bold<span class="md-marker">**</span> a' +
			'<span data-inline-widget data-source-start="9" data-source-end="14">x</span>b';
		expect(maskedWalkText(p)).toBe('  bold   a     b');
	});

	it('keeps the ambient prefix widget as text', () => {
		const p = document.createElement('p');
		p.innerHTML = '<span class="md-marker" contenteditable="false">- </span>item';
		expect(maskedWalkText(p)).toBe('- item');
	});
});

describe('granularityForClickCount', () => {
	it('maps two to the word, three and beyond to the block, one to nothing', () => {
		expect(granularityForClickCount(1)).toBeNull();
		expect(granularityForClickCount(2)).toBe('word');
		expect(granularityForClickCount(3)).toBe('block');
		expect(granularityForClickCount(5)).toBe('block');
	});
});

// Miss-analysis: the click order's refusals were read off the browser only, where a widget that
// selects whole ends up selected either way, so nothing named the press it must not take.
describe('installMultiClickSelect: the press the block level declines', () => {
	function thirdPressOnWidget(widgetSelected: boolean) {
		const root = document.createElement('div');
		const surface = document.createElement('div');
		// The property, not the attribute: jsdom does not reflect one onto the other, and the
		// surface walk reads the property.
		surface.contentEditable = 'true';
		surface.setAttribute('data-block-path', '[0]');
		const widget = document.createElement('span');
		widget.setAttribute('data-inline-widget', '');
		widget.setAttribute('data-source-start', '0');
		widget.setAttribute('data-source-end', '5');
		surface.append(widget);
		root.append(surface);
		document.body.append(root);
		// jsdom has no hit testing, and the claimed press goes on to look for its drag anchor.
		const origFromPoint = document.elementFromPoint;
		document.elementFromPoint = (() => widget) as typeof document.elementFromPoint;
		const dispose = installMultiClickSelect({
			editorRoot: root,
			selection: createSelectionState(),
			getBlockElByPath: () => null,
			getScrollContainer: () => root,
			marginBlockAt: () => null,
			pressesSelectedWidget: () => widgetSelected
		});
		const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 3 });
		widget.dispatchEvent(press);
		dispose();
		root.remove();
		document.elementFromPoint = origFromPoint;
		return press.defaultPrevented;
	}

	it('claims a third click on a widget nothing holds selected', () => {
		expect(thirdPressOnWidget(false)).toBe(true);
	});

	it('leaves a third click to a widget the editor already holds selected whole', () => {
		expect(thirdPressOnWidget(true)).toBe(false);
	});
});
