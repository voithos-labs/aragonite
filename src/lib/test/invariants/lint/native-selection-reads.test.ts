/**
 * G4.222: the browser's selection is read in named modules only, the bridge readers in
 * `selection/native-bridge.ts` and the modules below it that cannot import it, so an engine quirk
 * in what the selection reports gets fixed in one place (`docs/design/editor.md` § Browser engines).
 */

import { describeFileRules, notUnder, under, type FileRule, type Probe } from './file-rule';
import { collectEditorSources } from './scan-source';
import { SOURCE, SOURCE_DIR } from './source-paths';

const RECEIVER = String.raw`\b(?:window|document|globalThis|self|defaultView|ownerDocument)\s*[?!]?`;
// A call, a bare reference (`.bind`, a stored method), a bracket key, or a destructure off a global.
const NATIVE_SELECTION_READ = new RegExp(
	[
		String.raw`${RECEIVER}\.\s*getSelection\b`,
		String.raw`${RECEIVER}(?:\?\.)?\s*\[\s*['"\x60]getSelection['"\x60]\s*\]`,
		String.raw`\{[^{}]*\bgetSelection\b[^{}]*\}\s*=\s*${RECEIVER}`
	].join('|')
);

const BELOW_BRIDGE = 'the bridge loads caret/ at runtime, so caret/ cannot import it back';

const inLibrary = (code: string): Probe => ({ relPath: `${SOURCE_DIR.library}probe.ts`, code });

const NATIVE_SELECTION_READS: FileRule = {
	id: 'G4.222 the browser selection is read through the bridge readers',
	population: (file) => under(SOURCE_DIR.library)(file) && notUnder(SOURCE_DIR.debug)(file),
	matches: NATIVE_SELECTION_READ,
	allowed: {
		[SOURCE.nativeBridge]: 'the caret read as a point, until it calls the readers',
		[SOURCE.selectionRead]: 'the readers every other file calls',
		'src/lib/browser/caret-writer.ts': 'the caret writer',
		'src/lib/browser/text-seat.ts': 'whether the live caret sits in visible text',
		'src/lib/browser/focused-caret.ts': 'the caret a decoration rebuild keeps',
		'src/lib/browser/lines.ts': "the moving end's line",
		'src/lib/caret/drawn-caret.svelte.ts': `${BELOW_BRIDGE}: where the browser holds a caret`,
		'src/lib/caret/sticky-measure.ts': `${BELOW_BRIDGE}: the moving end's column`,
		'src/lib/schema/commands.ts':
			'a dev warning about a live range; selection imports the schema, so it cannot import back',
		'src/lib/invariants/landing-value.ts':
			"a dev check of the browser's own anchor around a landing; selection imports the invariants"
	},
	reaches: [SOURCE.nativeBridge, SOURCE.selectionRead],
	mustMatch: [SOURCE.selectionRead],
	reason:
		'engines differ in what the selection reports (a caret inside a widget, an anchor inside a CRLF pair), so the editor reads it in one place: call `readNativeSelection`, `rawSelectionIn`, `nativeRangeIn` or `holdsNativeRange` from selection/native-bridge.ts, or `rawSelectionFocus` (`docs/design/editor.md` § Browser engines)',
	hits: [
		'const sel = window.getSelection();',
		'if (window.getSelection()?.isCollapsed) return;',
		'const s = document.getSelection();',
		'root.ownerDocument.defaultView?.getSelection();',
		'el.ownerDocument!.getSelection()',
		'if (globalThis.getSelection?.()?.isCollapsed !== false) return;',
		'const sel = self.getSelection();',
		'const { getSelection } = window;',
		'const { getSelection: read } = document;',
		'const read = window.getSelection.bind(window);',
		"const sel = window['getSelection']();"
	].map(inLibrary),
	misses: [
		...[
			'const focus = deps.getSelection()?.focus;',
			'read: () => getSelection(),',
			'export function getSelection(): EditorSelection | null {',
			'const sel = readNativeSelection();',
			'const { getSelection } = deps;'
		].map(inLibrary),
		{ relPath: `${SOURCE_DIR.debug}probe.ts`, code: 'const sel = window.getSelection();' }
	]
};

describeFileRules([NATIVE_SELECTION_READS], collectEditorSources());
