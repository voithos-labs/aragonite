// @vitest-environment jsdom
//
// `data-list-marker` exists so the marker-hiding CSS can tell a bullet from a number
// from a checkbox — the ambient span carries no such class, and the three want
// different treatment when markers stop being source. The attribute is therefore a
// PRESENTATION-ONLY hook, and the derivation refuses outright in source mode so the
// source-mode DOM stays byte-identical to what it was before the modes existed.
//
// That refusal is the load-bearing half and the invisible one: a derivation that
// computed the attribute unconditionally would look correct in every presentation
// test, while the reading-mode rules keyed to it started matching during ordinary
// editing — bullets replaced by rendered chrome in the one mode that must show source.
// The e2e presentation suite owns the positive side in a real browser; what is missing
// is the mode that must paint nothing.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { PresentationMode } from '$lib/presentation-mode';
import { installLayoutStubs } from '../editor-mount';
import { mountItem, type MountedItem } from './mount-item';

beforeAll(installLayoutStubs);

const SHAPES: [label: string, source: string, marker: string][] = [
	['a bullet', '- alpha\n', 'bullet'],
	['an ordered item', '1. alpha\n', 'ordered'],
	['a task item', '- [ ] alpha\n', 'task']
];

let mounted: MountedItem | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

function markerAttrIn(mode: PresentationMode, source: string): string | null {
	mounted = mountItem(source, 0, { policies: { presentationMode: () => mode } });
	return mounted.box.getAttribute('data-list-marker');
}

describe('the list marker hook is presentation-only', () => {
	it.each(SHAPES)('source mode names no marker kind for %s', (_label, source) => {
		expect(markerAttrIn('source', source)).toBeNull();
	});

	it.each(SHAPES)('reading mode names %s as %s', (_label, source, marker) => {
		expect(markerAttrIn('reading', source)).toBe(marker);
	});

	// Both live-preview rungs share reading's marker-hiding CSS families, so they need
	// the same hook; only reading is covered in the browser.
	it.each(['preview-block', 'preview-inline'] as const)('%s names the marker kind too', (mode) => {
		expect(markerAttrIn(mode, '1. alpha\n')).toBe('ordered');
	});
});
