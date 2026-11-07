/**
 * G4.220: the editor reads and writes the system clipboard outside a copy or paste event in one
 * place, `editor-actions/system-clipboard.ts`, where a refused call resolves to nothing.
 */

import { describeFileRules, type FileRule } from './file-rule';
import { collectEditorSources } from './scan-source';

const CLIPBOARD_WRITES: FileRule = {
	id: 'G4.220 a clipboard read or write outside a clipboard event goes through system-clipboard.ts',
	matches: /\bclipboard\s*[!?]?\s*\.\s*(?:read|write)(?:Text)?\s*\(/,
	allowed: {
		'src/lib/editor-actions/system-clipboard.ts': 'the reader and writer every route calls'
	},
	reason:
		'a webview without clipboard access refuses the call, a call with no catch is an unhandled rejection, and a read made while a menu still shows gets Safari’s Paste prompt drawn over it: call readClipboardText, writeClipboardPayload or copyBlockToClipboard from editor-actions/system-clipboard.ts',
	hits: [
		'await navigator.clipboard.writeText(text);',
		'navigator.clipboard!.writeText(raw)',
		'navigator.clipboard.write([item]);',
		'const text = await navigator.clipboard.readText();'
	],
	misses: ['await writeClipboardText(text);', "e.clipboardData?.setData('text/plain', text);"]
};

describeFileRules([CLIPBOARD_WRITES], collectEditorSources());
