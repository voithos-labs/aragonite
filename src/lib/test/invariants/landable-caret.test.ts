// @vitest-environment jsdom
//
// Miss-analysis: the caret-placing calls were checked for where they put the caret (the clamp to
// a position the caret can sit at, G4.36) and never for whether the block they put it in paints
// anything at all, so a block with no such position was a shape no check named.
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
	// The attribute paints only under focus (the stylesheet's `:focus-within` rule), which is the
	// state "once its markers paint" asks about.
	if (stamped) el.focus();
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

	// Reading takes no keystrokes and source paints every byte, so neither can trap a caret.
	it('does nothing in reading and in source', () => {
		expect(checkLandableCaret(block('reading', '# '), 'reading', [0])).toBeNull();
		expect(checkLandableCaret(block(undefined, '# '), 'source', [0])).toBeNull();
	});

	// The caller hands it whatever took focus, which need not be the traversal container itself.
	it('resolves the surface from a landing inside it', () => {
		const marker = block('live', '# ').querySelector('span');
		expect(checkLandableCaret(marker as HTMLElement, 'live', [2])?.code).toBe('landable-caret');
	});

	it('does nothing for a landing outside any editable surface', () => {
		const host = block('live', '# ').parentElement;
		expect(checkLandableCaret(host as HTMLElement, 'live', [2])).toBeNull();
	});
});
