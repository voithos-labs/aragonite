// @vitest-environment jsdom
// An indented container's `link`: the editor draws its marker's first `length` characters as a
// link named `label`, a tab stop in reading mode only, and runs `follow` on the click the host
// picked for links or on Enter where it takes focus; any other click is the block's.
// Miss-analysis: the one marker that followed was a package's own prefix through an old view, so no
// row held a marker a maker draws from its lines.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { container, definePlugin, type Editor } from '#lib/plugin.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

interface NoteData {
	label: string;
}

const followed: { label: string; editor: Editor }[] = [];

/** A note on indented lines whose `[^label]` marker links back, recording each follow. */
function notes(link = true) {
	return definePlugin({
		name: link ? 'notes' : 'plain-notes',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				container<NoteData>({
					name: 'note',
					label: 'Note',
					sample: '[^a]: x',
					insert: { none: 'a test block type' },
					lines: {
						shape: 'indented',
						open: /^\[\^(\w+)\]: ?/,
						data: (match) => ({ label: match[1] }),
						first: (data) => `[^${data.label}]: `,
						rest: () => '    ',
						lazy: true,
						...(link && {
							link: {
								length: (data: NoteData) => data.label.length + 3,
								label: (data: NoteData) => `Back to ${data.label}`,
								follow: (data: NoteData, editor: Editor) =>
									void followed.push({ label: data.label, editor })
							}
						})
					}
				})
			]
		})
	});
}

function mounted(mode: PresentationMode, link = true) {
	followed.length = 0;
	const m = mountEditor({ source: '[^ab]: Body text.\n', plugins: [notes(link)] });
	m.props.presentationMode = mode;
	flushSync();
	const marker = m.target.querySelector<HTMLElement>('.md-marker')!;
	return { m, marker, link: marker.querySelector<HTMLElement>('[role="link"]') };
}

const click = (el: HTMLElement, init: MouseEventInit = {}) => {
	const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, ...init });
	el.dispatchEvent(event);
	return event;
};

describe("an indented container's marker link", () => {
	it('draws the marker’s first characters as a link named by its label, the rest as text', () => {
		const { marker, link } = mounted('source');
		expect(marker.textContent).toBe('[^ab]: ');
		expect(link?.textContent).toBe('[^ab]');
		expect(link?.getAttribute('aria-label')).toBe('Back to ab');
	});

	it.each(['source', 'live'] as const)('is no tab stop in %s mode', (mode) => {
		expect(mounted(mode).link?.hasAttribute('tabindex')).toBe(false);
	});

	it('is a tab stop in reading mode', () => {
		expect(mounted('reading').link?.tabIndex).toBe(0);
	});

	it.each(['source', 'live'] as const)(
		'follows on a modified click in %s mode, with its data and its plugin’s editor',
		(mode) => {
			const { m, link } = mounted(mode);
			const event = click(link!, { ctrlKey: true });
			expect(followed.map((each) => each.label)).toEqual(['ab']);
			expect(followed[0].editor.doc.text).toBe(m.source());
			expect(event.defaultPrevented).toBe(true);
		}
	);

	it.each(['source', 'live'] as const)('leaves a plain click to the block in %s mode', (mode) => {
		const event = click(mounted(mode).link!);
		expect(followed).toEqual([]);
		expect(event.defaultPrevented).toBe(false);
	});

	it('follows on a plain click and on Enter in reading mode', () => {
		const { link } = mounted('reading');
		click(link!);
		link!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(followed.map((each) => each.label)).toEqual(['ab', 'ab']);
	});

	it('draws a marker with no link as text', () => {
		const { marker, link } = mounted('reading', false);
		expect(marker.textContent).toBe('[^ab]: ');
		expect(link).toBeNull();
	});
});
