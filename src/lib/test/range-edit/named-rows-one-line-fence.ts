// Named rows for a one-line fence (`$$x^2$$`), each beside its twin on fence lines of its own: a
// range that starts or ends in the body takes body bytes only, both fences stay, and the block
// keeps apart from the one after it. Every gesture over one range: Backspace, Delete, a cut, a
// copy, a typed letter, a paste. A copy closes a fence on lines that it enters, in source mode
// only; a one-line opener cut off its closer opens nothing, so it stays as copied.
// Miss-analysis: the range core learned a fence only from a closer on its own line, and no row
// or law document held a one-line `$$` block, so every route that keeps a fence missed that form.

import type { Gesture } from '#lib/range-edit/edit-range.js';
import type { Mode } from '#lib/range-edit/host.js';
import type { NamedRow } from './named-rows';

const paste: Gesture = { paste: 'pq', plain: false, holds: 'text' };

interface Left {
	/** The bytes Backspace, Delete and a cut leave. */
	removed: string;
	typed: string;
	pasted: string;
	clip: string;
	/** The copy in live mode, where it differs. */
	liveClip?: string;
}

function rows(name: string, marked: string, left: Left): NamedRow[] {
	const source = marked.replace(/[⟦⟧]/g, '');
	return (['source', 'live'] as Mode[]).flatMap((mode) => {
		const clipboard = mode === 'live' ? (left.liveClip ?? left.clip) : left.clip;
		const at = (gesture: string) =>
			`one-line fence, ${name}: ${gesture}${mode === 'live' ? ', live' : ''}`;
		return [
			{
				name: at('Backspace'),
				source: marked,
				mode,
				gesture: 'backspace',
				expect: { source: left.removed }
			},
			{
				name: at('Delete'),
				source: marked,
				mode,
				gesture: 'delete',
				expect: { source: left.removed }
			},
			{
				name: at('a cut'),
				source: marked,
				mode,
				gesture: 'cut',
				expect: { source: left.removed, clipboard }
			},
			{ name: at('a copy'), source: marked, mode, gesture: 'copy', expect: { source, clipboard } },
			{
				name: at('a typed letter'),
				source: marked,
				mode,
				gesture: { text: 'z' },
				expect: { source: left.typed }
			},
			{ name: at('a paste'), source: marked, mode, gesture: paste, expect: { source: left.pasted } }
		];
	});
}

export const ONE_LINE_FENCE_ROWS: NamedRow[] = [
	...rows('from a one-line body’s start to the block’s end', 'Before\n\n$$⟦x^2$$⟧\n\nAfter\n', {
		removed: 'Before\n\n$$$$\n\nAfter\n',
		typed: 'Before\n\n$$z$$\n\nAfter\n',
		pasted: 'Before\n\n$$pq$$\n\nAfter\n',
		clip: 'x^2$$'
	}),
	...rows('the twin on fence lines', 'Before\n\n$$\n⟦x^2\n$$⟧\n\nAfter\n', {
		removed: 'Before\n\n$$\n\n$$\n\nAfter\n',
		typed: 'Before\n\n$$\nz\n$$\n\nAfter\n',
		pasted: 'Before\n\n$$\npq\n$$\n\nAfter\n',
		clip: 'x^2\n$$'
	}),
	...rows('from mid-body to the block’s end', 'Before\n\n$$x⟦^2$$⟧\n\nAfter\n', {
		removed: 'Before\n\n$$x$$\n\nAfter\n',
		typed: 'Before\n\n$$xz$$\n\nAfter\n',
		pasted: 'Before\n\n$$xpq$$\n\nAfter\n',
		clip: '^2$$'
	}),
	...rows('from mid-body into the closer', 'Before\n\n$$x⟦^2$⟧$\n\nAfter\n', {
		removed: 'Before\n\n$$x$$\n\nAfter\n',
		typed: 'Before\n\n$$xz$$\n\nAfter\n',
		pasted: 'Before\n\n$$xpq$$\n\nAfter\n',
		clip: '^2$'
	}),
	...rows('in a quote, from mid-body to the block’s end', 'Before\n\n> $$x⟦^2$$⟧\n\nAfter\n', {
		removed: 'Before\n\n> $$x$$\n\nAfter\n',
		typed: 'Before\n\n> $$xz$$\n\nAfter\n',
		pasted: 'Before\n\n> $$xpq$$\n\nAfter\n',
		clip: '^2$$'
	}),
	...rows('in CRLF, from mid-body to the block’s end', 'Before\r\n\r\n$$x⟦^2$$⟧\r\n\r\nAfter\r\n', {
		removed: 'Before\r\n\r\n$$x$$\r\n\r\nAfter\r\n',
		typed: 'Before\r\n\r\n$$xz$$\r\n\r\nAfter\r\n',
		pasted: 'Before\r\n\r\n$$xpq$$\r\n\r\nAfter\r\n',
		clip: '^2$$'
	}),
	...rows('from the paragraph above into a one-line body', 'Bef⟦ore\n\n$$x⟧^2$$\n\nAfter\n', {
		removed: 'Bef\n\n$$^2$$\n\nAfter\n',
		typed: 'Befz\n\n$$^2$$\n\nAfter\n',
		pasted: 'Befpq\n\n$$^2$$\n\nAfter\n',
		clip: 'ore\n\n$$x'
	}),
	...rows('the twin on fence lines', 'Bef⟦ore\n\n$$\nx⟧^2\n$$\n\nAfter\n', {
		removed: 'Bef\n\n$$\n^2\n$$\n\nAfter\n',
		typed: 'Befz\n\n$$\n^2\n$$\n\nAfter\n',
		pasted: 'Befpq\n\n$$\n^2\n$$\n\nAfter\n',
		clip: 'ore\n\n$$\nx\n$$',
		liveClip: 'ore\n\n$$\nx'
	}),
	...rows('the same range again, on the emptied block', 'Before\n\n$$⟦$$⟧\n\nAfter\n', {
		removed: 'Before\n\n$$$$\n\nAfter\n',
		typed: 'Before\n\n$$z$$\n\nAfter\n',
		pasted: 'Before\n\n$$pq$$\n\nAfter\n',
		clip: ''
	}),
	...rows('from an empty one-line body into the paragraph below', 'Before\n\n$$⟦$$\n\nAf⟧ter\n', {
		removed: 'Before\n\n$$$$\nter\n',
		typed: 'Before\n\n$$z$$\nter\n',
		pasted: 'Before\n\n$$pq$$\nter\n',
		clip: '$$\n\nAf'
	}),
	...rows('from mid-body into the paragraph below', 'Before\n\n$$x⟦^2$$\n\nAf⟧ter\n', {
		removed: 'Before\n\n$$x$$\nter\n',
		typed: 'Before\n\n$$xz$$\nter\n',
		pasted: 'Before\n\n$$xpq$$\nter\n',
		clip: '^2$$\n\nAf'
	})
];
