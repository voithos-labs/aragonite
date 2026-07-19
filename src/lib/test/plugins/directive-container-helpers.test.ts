import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { chromeChild, declaredPluginKind } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import {
	registerCalloutKind,
	rebuildCalloutRaw,
	NOTE_TITLE
} from '../../../routes/test/plugins/callout/callout-kind';

// `createDirectiveRebuild` (exercised through the callout instance that binds it,
// `rebuildCalloutRaw`) and `chromeChild`. The rebuild factory is the shared body
// behind both callout and admonitions — the only per-kind difference is the name
// resolver — so its byte-assembly is pinned once here.

describe('createDirectiveRebuild threads the authored line ending', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerCalloutKind();
	});

	// The guard the factory exists for: a hand-written copy that forgot `lineEnding`
	// would normalize the synthesized opener/closer to `\n`. Drop `lineEnding` from
	// the factory and this goes red.
	it('reproduces CRLF on the opener and closer when a child edit rebuilds', () => {
		const note = parse(':::note My Title\r\nBody\r\n:::\r\n').children[0];
		note.children![1].raw = 'edited\r\n';
		rebuildCalloutRaw(note);
		expect(note.raw).toBe(':::note My Title\r\nedited\r\n:::\r\n');
	});

	it('keeps LF chrome lines for an LF-authored directive', () => {
		const note = parse(':::note My Title\nBody\n:::\n').children[0];
		note.children![1].raw = 'edited\n';
		rebuildCalloutRaw(note);
		expect(note.raw).toBe(':::note My Title\nedited\n:::\n');
	});

	it('re-emits the title from child 0 and the variant name from metadata', () => {
		const note = parse(':::warning Watch out\r\nBody\r\n:::\r\n').children[0];
		rebuildCalloutRaw(note);
		expect(note.raw).toBe(':::warning Watch out\r\nBody\r\n:::\r\n');
	});

	it('drops the opener info when child 0 is empty', () => {
		const note = parse(':::note\nBody\n:::\n').children[0];
		rebuildCalloutRaw(note);
		expect(note.raw).toBe(':::note\nBody\n:::\n');
	});
});

describe('chromeChild builds the reserved child-0 node', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerCalloutKind();
	});

	it('appends a trailing newline to non-empty title text', () => {
		const child = chromeChild(declaredPluginKind(NOTE_TITLE), 'Heads up');
		expect(child).toMatchObject({ kind: NOTE_TITLE, leadingTrivia: '', raw: 'Heads up\n' });
	});

	it('collapses empty text to a bare newline so the leaf still holds a line', () => {
		expect(chromeChild(declaredPluginKind(NOTE_TITLE), '').raw).toBe('\n');
	});
});
