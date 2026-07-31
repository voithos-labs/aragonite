/**
 * Consumer-guide chord coherence: every chord in consumer-guide.md § Keyboard shortcuts
 * must resolve in the code that dispatches it, so the hand-listed table can't drift.
 * Chords route through several owners, and each family is validated against its own:
 * Editing / Block reorder / Tables against the keymap registry; Find / replace against
 * literal presence in the two search dispatch sites plus the reserved-chord source; and
 * Clipboard against BOTH the whole-block key tail and the text block's clipboard seam,
 * because a keydown carries no ClipboardEvent and Mod+C/Mod+X route outside the keymap.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { registerBuiltInDescriptors } from '$lib/schema/built-in-descriptors';
import { resolveBinding } from '$lib/schema/commands';
import { getAllRegisteredKinds } from '$lib/schema/block-kind-descriptor';
import { normalizeChord } from '$lib/schema/keybindings';
import { readEditorFile } from './scan-source';

registerBuiltInDescriptors();

// ── Doc parsing ─────────────────────────────────────────────────────────────
// Map the display key names the doc uses to the event key names the code sees.
const KEY_ALIASES: Record<string, string> = {
	'↑': 'ArrowUp',
	'↓': 'ArrowDown',
	'←': 'ArrowLeft',
	'→': 'ArrowRight',
	Esc: 'Escape'
};

function normalizeDocChord(raw: string): string {
	const parts = raw.split('+');
	const key = parts.pop() ?? '';
	return normalizeChord([...parts, KEY_ALIASES[key] ?? key].join('+'));
}

// Family header → normalized chords under it. Parenthetical prose is stripped first so
// its incidental backtick tokens aren't mistaken for chords.
function parseDocumentedChords(): Map<string, string[]> {
	const guide = readFileSync(path.resolve('docs/guide/consumer-guide.md'), 'utf8');
	const section = guide.split('## Keyboard shortcuts')[1]?.split('\n## ')[0] ?? '';

	const byFamily = new Map<string, string[]>();
	let family: string | null = null;
	for (const line of section.split('\n')) {
		if (!line.trimStart().startsWith('|')) continue;
		const cells = line.split('|').map((c) => c.trim());
		const action = cells[1] ?? '';
		const chordCell = cells[2] ?? '';
		if (action === 'Action' || /^:?-+:?$/.test(action)) continue;
		if (chordCell === '' && action.startsWith('**')) {
			family = action.replaceAll('*', '').trim();
			byFamily.set(family, []);
			continue;
		}
		if (chordCell === '' || family === null) continue;
		const tokens = chordCell.replace(/\([^)]*\)/g, '').match(/`([^`]+)`/g) ?? [];
		for (const tok of tokens) byFamily.get(family)!.push(normalizeDocChord(tok.slice(1, -1)));
	}
	for (const [f, chords] of byFamily) byFamily.set(f, [...new Set(chords)]);
	return byFamily;
}

// ── Per-family resolvers ─────────────────────────────────────────────────────
function keymapResolves(chord: string): boolean {
	return getAllRegisteredKinds().some((kind) => resolveBinding(chord, kind) !== null);
}

// Find/replace routes through the search components, and the reserved Ctrl+F / Ctrl+H
// pair single-sources from schema/commands.ts. Each value is the token the chord must
// show in that (comment-stripped) source.
const SEARCH_SOURCE = [
	readEditorFile('components/editor-root-keydown.ts').code,
	readEditorFile('components/SearchBar.svelte').code,
	readEditorFile('schema/commands.ts').code
].join('\n');
const SEARCH_CHORD_TOKENS: Record<string, string[]> = {
	'Mod+F': ["'Mod+F'"],
	'Mod+H': ["'Mod+H'"],
	Escape: ["'Escape'"],
	Enter: ["'Enter'"],
	'Shift+Enter': ["'Enter'", 'shiftKey']
};

function searchResolves(chord: string): boolean {
	const tokens = SEARCH_CHORD_TOKENS[chord];
	return tokens !== undefined && tokens.every((t) => SEARCH_SOURCE.includes(t));
}

// Each chord names one token from the tail branch and one from the widget branch, so
// deleting either dispatch fails the row it documents. Tokens are code shapes, so they
// survive comment-stripping.
const CLIPBOARD_SOURCE = [
	readEditorFile('editor-actions/container-block-component.ts').code,
	readEditorFile('components/blocks/text/text-clipboard.ts').code
].join('\n');
const CLIPBOARD_CHORD_TOKENS: Record<string, string[]> = {
	'Mod+C': ['(e.ctrlKey || e.metaKey)', "e.key === 'c'", 'widget.inline.start'],
	'Mod+X': [
		'(e.ctrlKey || e.metaKey)',
		"e.key === 'x'",
		'deps.node.raw.slice(inline.start, inline.end)'
	]
};

function clipboardResolves(chord: string): boolean {
	const tokens = CLIPBOARD_CHORD_TOKENS[chord];
	return tokens !== undefined && tokens.every((t) => CLIPBOARD_SOURCE.includes(t));
}

const RESOLVERS: Record<string, (chord: string) => boolean> = {
	Editing: keymapResolves,
	'Block reorder': keymapResolves,
	Tables: keymapResolves,
	'Find / replace': searchResolves,
	Clipboard: clipboardResolves
};

// ── Tests ─────────────────────────────────────────────────────────────────
const documented = parseDocumentedChords();

describe('consumer-guide § Keyboard shortcuts — every documented chord resolves in code', () => {
	for (const [family, chords] of documented) {
		it(`${family}: all chords dispatch`, () => {
			const resolve = RESOLVERS[family];
			expect(resolve, `no resolver for documented family "${family}"`).toBeTypeOf('function');
			const unresolved = chords.filter((c) => !resolve(c));
			expect(unresolved, `${family} chords with no dispatch: ${unresolved.join(', ')}`).toEqual([]);
		});
	}
});

// ── Non-vacuity self-tests ───────────────────────────────────────────────────
// Without these a broken parser or a permanently-true resolver lets the guards above
// pass on nothing.

describe('consumer-guide chord coherence — self-tests', () => {
	it('parses every documented family with a representative chord', () => {
		expect([...documented.keys()].sort()).toEqual(
			['Block reorder', 'Clipboard', 'Editing', 'Find / replace', 'Tables'].sort()
		);
		expect(documented.get('Editing')).toContain('Mod+B');
		expect(documented.get('Block reorder')).toContain('Alt+ArrowUp');
		expect(documented.get('Find / replace')).toContain('Escape');
		expect(documented.get('Tables')).toContain('Mod+Shift+A');
		expect(documented.get('Clipboard')).toContain('Mod+C');
	});

	it('resolvers reject a chord that is dispatched nowhere', () => {
		expect(keymapResolves('Mod+Q')).toBe(false);
		expect(searchResolves('Mod+Q')).toBe(false);
		expect(clipboardResolves('Mod+Q')).toBe(false);
	});

	it('normalizes the doc display names the code never sees', () => {
		expect(normalizeDocChord('Alt+↑')).toBe('Alt+ArrowUp');
		expect(normalizeDocChord('Esc')).toBe('Escape');
		expect(normalizeDocChord('Mod+Shift+A')).toBe('Mod+Shift+A');
	});
});
