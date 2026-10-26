/**
 * G4.270: what the browser holds for editing is read and written only under `browser/` (the
 * selection, `Selection.modify`, the caret at a point), so an engine quirk in any of them is
 * fixed in one module (`docs/design/editor.md` § Browser engines). Inside it, only the caret
 * writer writes the selection.
 */

import { describeFileRules, notUnder, under, type FileRule, type Probe } from './file-rule';
import { collectEditorSources, type SourceFile } from './scan-source';
import { NATIVE_SELECTION_WRITE } from './native-selection-write';
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

const at = (relPath: string, code: string): Probe => ({ relPath, code });
const inLibrary = (code: string): Probe => at(`${SOURCE_DIR.library}probe.ts`, code);
const inBrowser = (code: string): Probe => at(`${SOURCE_DIR.browser}probe.ts`, code);

const outsideBrowser = (file: SourceFile): boolean =>
	under(SOURCE_DIR.library)(file) && notUnder(SOURCE_DIR.browser)(file);

const RULES: FileRule[] = [
	{
		id: 'G4.270 the browser selection is read only under browser/',
		// The input recorder in debug/ reads what it records, and ships in no editor path.
		population: (file) => outsideBrowser(file) && notUnder(SOURCE_DIR.debug)(file),
		matches: NATIVE_SELECTION_READ,
		reaches: [SOURCE.nativeBridge, SOURCE.commands],
		mustMatch: [SOURCE.selectionRead],
		reason:
			'engines differ in what the selection reports (a caret inside a widget, an anchor inside a CRLF pair), so the editor reads it in one place: call a reader in browser/selection-read.ts (`readNativeSelection`, `rawSelectionIn`, `rawSelectionFocus`, `nativeRangeIn`, `holdsNativeRange`), or take one as a parameter where your directory cannot import browser/',
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
			inBrowser('const sel = window.getSelection();'),
			at(`${SOURCE_DIR.debug}probe.ts`, 'const sel = window.getSelection();')
		]
	},
	{
		id: 'G4.270 the native selection is written only by the caret writer',
		// A one-argument collapse counts on a selection only: Range.collapse(toStart) and the
		// selection store's own collapse() write no caret.
		population: (file) => file.relPath !== SOURCE.caretWriter,
		matches: NATIVE_SELECTION_WRITE,
		mustMatch: [SOURCE.caretWriter],
		reaches: [SOURCE.nativeBridge, SOURCE.selectionRead],
		reason:
			'every write, clear or `Selection.modify` of the native selection goes through the editor’s caret writer (EditorServices.caretWriter), which skips the marker prefix, clamps, remembers the caret it wrote and asks the drawn caret to repaint: move through `moveCaretToLineEdge` or `extendToLineEdge`, or ask `focusEndsLine`',
		hits: [
			'sel?.addRange(range);',
			'window.getSelection()?.removeAllRanges();',
			'sel.empty();',
			'sel.setBaseAndExtent(n, 0, n, 0);',
			'sel.extend(node, 2);',
			'window.getSelection()?.collapse(node, 2);',
			'sel.setPosition(node, 2);',
			'sel.selectAllChildren(node);',
			'sel.collapseToEnd();',
			'sel.collapseToStart();',
			"sel.modify('move', 'forward', 'character');",
			"window.getSelection()!.modify ('extend', 'left', 'lineboundary');",
			'sel.collapse(node);',
			'window.getSelection()?.collapse(node);',
			'window.getSelection()!.collapse(node);',
			'sel.setPosition(node);',
			inBrowser("sel.modify('move', 'forward', 'lineboundary');")
		],
		misses: [
			'sel.getRangeAt(0);',
			'selectionState.collapse();',
			'ctx.selection.collapse();',
			'range.collapse(true);',
			'range.collapse(toStart);',
			'const modified = view.modifiedAt;',
			'modify(node);'
		]
	},
	{
		id: 'G4.270 the browser is asked for a caret at a point only under browser/',
		population: (file) => !file.relPath.startsWith(SOURCE_DIR.browser),
		matches: /\bcaret(Range|Position)FromPoint\b/,
		mustMatch: [SOURCE.pointLookup],
		reason:
			'Mac and Linux Chromium answer a point in an element’s top or bottom padding with the line’s start or end: resolve a point through offsetFromViewportPoint or caretOffsetAtPoint (browser/point.ts)',
		hits: [
			'const r = document.caretRangeFromPoint(x, y);',
			'const p = (doc as any).caretPositionFromPoint?.(x, y);'
		],
		misses: [
			'const offset = offsetFromViewportPoint(el, x, y);',
			'const seat = caretSeatFromPoint(document, x, y);',
			'// never call caretRangeFromPoint here\nconst a = 1;',
			inBrowser('const r = document.caretRangeFromPoint(x, y);')
		]
	}
];

describeFileRules(RULES, collectEditorSources());
