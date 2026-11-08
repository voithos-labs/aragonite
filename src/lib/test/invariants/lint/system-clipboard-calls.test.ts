/**
 * G4.220: the editor reads and writes the system clipboard outside a copy or paste event in one
 * place, `browser/clipboard.ts`, where a refused call resolves to nothing. G4.314: a copy or cut
 * event's clipboard is written there too, so every copy keeps the editor's own entry.
 */

import { describeFileRules, type FileRule } from './file-rule';
import { collectEditorSources } from './scan-source';

const CLIPBOARD_WRITES: FileRule = {
	id: 'G4.220 a clipboard read or write outside a clipboard event goes through browser/clipboard.ts',
	matches: /\bclipboard\s*[!?]?\s*\.\s*(?:read|write)(?:Text)?\s*\(/,
	allowed: {
		'src/lib/browser/clipboard.ts': 'the reader and writer every route calls'
	},
	reason:
		'a webview without clipboard access refuses the call, a call with no catch is an unhandled rejection, and a read made while a menu still shows gets Safari’s Paste prompt drawn over it: call readClipboardText, writeClipboardPayload or copyBlockToClipboard from browser/clipboard.ts',
	hits: [
		'await navigator.clipboard.writeText(text);',
		'navigator.clipboard!.writeText(raw)',
		'navigator.clipboard.write([item]);',
		'const text = await navigator.clipboard.readText();'
	],
	misses: ['await writeClipboardText(text);', "e.clipboardData?.setData('text/plain', text);"]
};

const EVENT_WRITES: FileRule = {
	id: 'G4.314 a copy or cut event is written through browser/clipboard.ts',
	matches: /\.\s*setData\s*\(/,
	allowed: {
		'src/lib/browser/clipboard.ts': 'the one writer of a copy event and the in-memory entry'
	},
	reason:
		'a copy written past it drops the editor’s own entry and leaves the in-memory copy naming text that is no longer on the clipboard: call writeClipboardEvent from browser/clipboard.ts',
	hits: ["e.clipboardData?.setData('text/plain', text);", 'data.setData(type, value)'],
	misses: ['writeClipboardEvent(e, { text });', "e.clipboardData?.getData('text/plain')"]
};

describeFileRules([CLIPBOARD_WRITES, EVENT_WRITES], collectEditorSources());
