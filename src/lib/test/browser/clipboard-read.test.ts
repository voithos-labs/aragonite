// @vitest-environment jsdom
// One paste is one clipboard read: every type the event carries, its text with LF line endings, and
// the editor's own entry by its type, or from memory where the clipboard hands over the text alone.
// Miss-analysis: nothing read the own entry back, so its text match was never run against a
// clipboard whose line endings the system rewrote.
import { describe, expect, it } from 'vitest';
import {
	OWN_CLIPBOARD_TYPE,
	readPasteEvent,
	scriptedClip,
	writeClipboardEvent
} from '#lib/browser/clipboard.js';
import { StubDataTransfer } from '#lib/test/harness/clipboard-events.js';

const event = (payload: Record<string, string>) =>
	({ clipboardData: new StubDataTransfer(payload) }) as unknown as ClipboardEvent;

describe('a paste event’s read', () => {
	it('takes every type, and its text with LF line endings', () => {
		const read = readPasteEvent(event({ 'text/plain': 'a\r\nb', 'text/html': '<p>a</p>' }));
		expect(read.text).toBe('a\nb');
		expect(read.types).toEqual({ 'text/plain': 'a\r\nb', 'text/html': '<p>a</p>' });
		expect(read.plain).toBe(false);
	});

	it('carries the editor’s own entry by its type', () => {
		const read = readPasteEvent(event({ 'text/plain': 'zzz', [OWN_CLIPBOARD_TYPE]: 'entry' }));
		expect(read.own).toBe('entry');
	});

	it('finds the entry in memory by text whose line endings the system rewrote', () => {
		writeClipboardEvent(event({}), { text: 'one\ntwo', own: 'kept' });
		expect(readPasteEvent(event({ 'text/plain': 'one\r\ntwo' })).own).toBe('kept');
		expect(readPasteEvent(event({ 'text/plain': 'one\ntwo!' })).own).toBeUndefined();
	});

	it('says plain where the chord did', () => {
		expect(readPasteEvent(event({ 'text/plain': 'x' }), true).plain).toBe(true);
	});
});

it('text a caller hands over carries no entry, whatever the clipboard last held', () => {
	writeClipboardEvent(event({}), { text: 'same', own: 'kept' });
	expect(scriptedClip('same').own).toBeUndefined();
});
