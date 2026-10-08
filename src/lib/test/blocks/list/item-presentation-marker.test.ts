// @vitest-environment jsdom
// `data-list-marker` lets the marker-hiding CSS tell a bullet from a number from a checkbox. It
// is never set in source mode: set unconditionally, it passes every presentation test while the
// reading-mode rules match during ordinary editing.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { installLayoutStubs } from '#lib/test/harness/mount-editor.svelte.js';
import { mountItem, type MountedItem } from './mount-item';
import { allowDevWarns } from '#lib/test/support/warn-gate.js';

// The harness mounts BlockHost without the component layer, so unregistered kinds render raw.
afterEach(() => allowDevWarns(['block-host']));

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

	// Every other mode shares reading mode's marker-hiding CSS, so each needs the same
	// attribute; without it a live bullet is a blank hanging indent with nothing drawn.
	it.each(['preview-block', 'preview-inline', 'live'] as const)(
		'%s names the marker kind too',
		(mode) => {
			expect(markerAttrIn(mode, '1. alpha\n')).toBe('ordered');
		}
	);
});
