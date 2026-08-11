// @vitest-environment jsdom
//
// Miss-analysis: the caret doors were guarded for WHERE they seat (the landable clamp, G4.36) and
// never for whether the block they seat into paints anything at all, so a surface with no landable
// position at all was a shape no guard named.
import { describe, it, expect, afterEach } from 'vitest';
import { checkLandableCaret } from '../../invariants/landable-caret';
import { CONTENT_EMPTY_ATTR } from '../../cursor/widget-offset';

function block(mode: string | undefined, marker: string, stamped = false): HTMLElement {
	const root = document.createElement('div');
	if (mode) root.setAttribute('data-presentation', mode);
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	if (stamped) el.setAttribute(CONTENT_EMPTY_ATTR, '');
	const span = document.createElement('span');
	span.className = 'md-marker';
	span.textContent = marker;
	el.appendChild(span);
	root.appendChild(el);
	document.body.appendChild(root);
	return el;
}

afterEach(() => document.body.replaceChildren());

describe('checkLandableCaret (G1.33)', () => {
	it('fires on a block whose every byte is a hidden marker run', () => {
		const violation = checkLandableCaret(block('live', '# '), 'live', [2]);
		expect(violation?.code).toBe('landable-caret');
		expect(violation?.detail).toMatchObject({ path: [2], mode: 'live' });
	});

	it('accepts the same block once its chrome paints', () => {
		expect(checkLandableCaret(block('live', '# ', true), 'live', [2])).toBeNull();
	});

	// Reading takes no keystrokes, and source paints every byte — neither can trap a caret.
	it('stands down in reading and in source', () => {
		expect(checkLandableCaret(block('reading', '# '), 'reading', [0])).toBeNull();
		expect(checkLandableCaret(block(undefined, '# '), 'source', [0])).toBeNull();
	});
});
