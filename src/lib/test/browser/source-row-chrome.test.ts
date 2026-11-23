// @vitest-environment jsdom
// When a row that shows its source at the caret (a `:::` opener line) paints its markers: a titled
// row with its host's `data-focused`, an untitled one with focus inside, as `styles/editor.css` has it.
// Miss-analysis: the row's paint was read off focus alone, so no test could tell a held press from
// a caret already in the row, and a click was hit-tested after the text had moved.
import { describe, it, expect, afterEach } from 'vitest';
import {
	CONTENT_EMPTY_ATTR,
	PRESS_HELD_ATTR,
	SOURCE_AT_CARET_ATTR,
	hidesRowSource,
	isHiddenMarkerRoot,
	screenVisibilityOf
} from '../../browser/painted';
import type { PresentationMode } from '../../presentation-mode';

afterEach(() => document.body.replaceChildren());

interface RowOptions {
	mode?: PresentationMode;
	title?: string;
	hostFocused?: boolean;
	focused?: boolean;
	pressHeld?: boolean;
}

function mountRow({
	mode,
	title = '',
	hostFocused = false,
	focused = false,
	pressHeld = false
}: RowOptions) {
	const root = document.createElement('div');
	if (mode) root.setAttribute('data-presentation', mode);
	if (pressHeld) root.setAttribute(PRESS_HELD_ATTR, '');
	const host = document.createElement('div');
	host.className = 'block-host';
	if (hostFocused) host.setAttribute('data-focused', '');
	const row = document.createElement('div');
	row.setAttribute('contenteditable', 'true');
	row.setAttribute(SOURCE_AT_CARET_ATTR, '');
	if (title === '') row.setAttribute(CONTENT_EMPTY_ATTR, '');
	const marker = document.createElement('span');
	marker.className = 'md-marker';
	marker.textContent = title === '' ? ':::tip' : ':::tip ';
	row.append(marker, document.createTextNode(title));
	host.append(row);
	root.append(host);
	document.body.append(root);
	if (focused) row.focus();
	return { row, marker };
}

describe('a titled source-at-caret row', () => {
	it('paints its markers with its host marked focused, in live and the preview modes', () => {
		for (const mode of ['live', 'preview-block', 'preview-inline'] as const) {
			const { row, marker } = mountRow({ mode, title: 'Title', hostFocused: true, focused: true });
			expect(screenVisibilityOf(row).chromePaints, mode).toBe(true);
			expect(isHiddenMarkerRoot(marker, row), mode).toBe(false);
			expect(hidesRowSource(row), mode).toBe(false);
		}
	});

	it('keeps them hidden while it holds focus under a press, its host not yet marked', () => {
		const { row, marker } = mountRow({
			mode: 'live',
			title: 'Title',
			focused: true,
			pressHeld: true
		});
		expect(screenVisibilityOf(row).chromePaints).toBe(false);
		expect(isHiddenMarkerRoot(marker, row)).toBe(true);
		expect(hidesRowSource(row)).toBe(true);
	});

	// Miss-analysis: the held-press row stood for every focus its host's mark had not reached, so
	// none mounted focus with no press, the state WebKit writes a landing's caret in.
	it('paints them as focus arrives with no press, before its host is marked', () => {
		const { row, marker } = mountRow({ mode: 'live', title: 'Title', focused: true });
		expect(screenVisibilityOf(row).chromePaints).toBe(true);
		expect(isHiddenMarkerRoot(marker, row)).toBe(false);
		expect(hidesRowSource(row)).toBe(false);
	});

	it('hides no source in source mode, where nothing hides', () => {
		const { row } = mountRow({ title: 'Title' });
		expect(hidesRowSource(row)).toBe(false);
	});
});

describe('an untitled source-at-caret row', () => {
	it('paints its markers with focus inside, whether or not its host is marked', () => {
		const { row, marker } = mountRow({ mode: 'live', focused: true });
		expect(screenVisibilityOf(row).chromePaints).toBe(true);
		expect(isHiddenMarkerRoot(marker, row)).toBe(false);
	});

	it('hides them without focus, even under a marked host', () => {
		const { row } = mountRow({ mode: 'live', hostFocused: true });
		expect(screenVisibilityOf(row).chromePaints).toBe(false);
		expect(hidesRowSource(row)).toBe(true);
	});
});
