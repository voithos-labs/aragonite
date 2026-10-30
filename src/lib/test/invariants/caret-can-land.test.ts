// @vitest-environment jsdom
// Miss-analysis: the caret checks asked where a caret went, never whether its block paints at all.
import { describe, it, expect, afterEach } from 'vitest';
import { checkCaretCanLand } from '../../invariants/caret-can-land';
import { CONTENT_EMPTY_ATTR } from '../../browser/painted';

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
	// state the "once its chrome paints" case asks about.
	if (stamped) el.focus();
	return el;
}

afterEach(() => document.body.replaceChildren());

describe('checkCaretCanLand (G1.33)', () => {
	it('fires on a block whose every byte is a hidden marker run', () => {
		const violation = checkCaretCanLand(block('live', '# '), 'live', [2]);
		expect(violation?.code).toBe('caret-can-land');
		expect(violation?.detail).toMatchObject({ path: [2], mode: 'live' });
	});

	it('accepts the same block once its chrome paints', () => {
		expect(checkCaretCanLand(block('live', '# ', true), 'live', [2])).toBeNull();
	});

	// Reading takes no keystrokes and source paints every byte, so neither can trap a caret.
	it('does nothing in reading and in source', () => {
		expect(checkCaretCanLand(block('reading', '# '), 'reading', [0])).toBeNull();
		expect(checkCaretCanLand(block(undefined, '# '), 'source', [0])).toBeNull();
	});

	// The caller hands it whatever took focus, which need not be the traversal container itself.
	it('resolves the surface from a landing inside it', () => {
		const marker = block('live', '# ').querySelector('span');
		expect(checkCaretCanLand(marker as HTMLElement, 'live', [2])?.code).toBe('caret-can-land');
	});

	it('does nothing for a landing outside any editable surface', () => {
		const host = block('live', '# ').parentElement;
		expect(checkCaretCanLand(host as HTMLElement, 'live', [2])).toBeNull();
	});
});
