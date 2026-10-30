/**
 * G4.270: what the browser holds for editing is read and written only under `browser/` (the
 * selection, `Selection.modify`, what sits at a point, what an input asks for), so an engine quirk
 * in any of them is fixed in one module (`docs/design/editor.md` § Browser engines). Inside it, the
 * selection is read in `selection-read.ts` and the writer, written by the writer, a point asked in
 * `point.ts` and an input read in `input.ts`.
 */

import { describeFileRules, except, notUnder, under, type FileRule, type Probe } from './file-rule';
import { collectEditorSources, type SourceFile } from './scan-source';
import { NATIVE_SELECTION_WRITE } from './native-selection-write';
import { SOURCE, SOURCE_DIR } from './source-paths';

const RECEIVER = String.raw`\b(?:window|document|globalThis|self|defaultView|ownerDocument)\s*[?!]?`;
// A call, a bare reference (`.bind`, a stored method), a bracket key, or a destructure off a global,
// or the method taken off its prototype.
const NATIVE_SELECTION_READ = new RegExp(
	[
		String.raw`${RECEIVER}\.\s*getSelection\b`,
		String.raw`\b(?:Window|Document)\s*\.\s*prototype\s*\.\s*getSelection\b`,
		String.raw`${RECEIVER}(?:\?\.)?\s*\[\s*['"\x60]getSelection['"\x60]\s*\]`,
		String.raw`\{[^{}]*\bgetSelection\b[^{}]*\}\s*=\s*${RECEIVER}`
	].join('|')
);

const at = (relPath: string, code: string): Probe => ({ relPath, code });
const inLibrary = (code: string): Probe => at(`${SOURCE_DIR.library}probe.ts`, code);
const inBrowser = (code: string): Probe => at(`${SOURCE_DIR.browser}probe.ts`, code);

// The input recorder in debug/ reads what it records, and ships in no editor path; the writer
// reads the live selection it writes.
const bindsSelectionRead = (file: SourceFile): boolean =>
	under(SOURCE_DIR.library, SOURCE_DIR.plugins)(file) &&
	notUnder(SOURCE_DIR.debug)(file) &&
	except(SOURCE.selectionRead, SOURCE.caretWriter)(file);

const RULES: FileRule[] = [
	{
		id: 'G4.270 the browser selection is read only by its readers in browser/',
		population: bindsSelectionRead,
		matches: NATIVE_SELECTION_READ,
		reaches: [SOURCE.nativeBridge, SOURCE.commands, SOURCE.pointLookup],
		mustMatch: [SOURCE.selectionRead],
		reason:
			'engines differ in what the selection reports (a caret inside a widget, an anchor inside a CRLF pair), so the editor reads it in one place, browser/ included: call a reader in browser/selection-read.ts (`readNativeSelection`, `rawSelectionIn`, `rawSelectionFocus`, `nativeRangeIn`, `holdsNativeRange`), or take one as a parameter where your directory cannot import browser/',
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
			"const sel = window['getSelection']();",
			'const sel = Document.prototype.getSelection.call(document);'
		]
			.map(inLibrary)
			.concat(inBrowser('const sel = window.getSelection();')),
		misses: [
			...[
				'const focus = deps.getSelection()?.focus;',
				'read: () => getSelection(),',
				'export function getSelection(): EditorSelection | null {',
				'const sel = readNativeSelection();',
				'const { getSelection } = deps;'
			].map(inLibrary),
			at(SOURCE.selectionRead, 'const sel = window.getSelection();'),
			at(SOURCE.caretWriter, 'const sel = window.getSelection();'),
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
			"sel['addRange'](range);",
			"Selection.prototype.modify.call(sel, 'move', 'forward', 'line');",
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
		id: 'G4.270 the browser is asked for a caret at a point only in browser/point.ts',
		population: except(SOURCE.pointLookup),
		matches: /\bcaret(Range|Position)FromPoint\b/,
		mustMatch: [SOURCE.pointLookup],
		reason:
			'Mac and Linux Chromium answer a point in an element’s top or bottom padding with the line’s start or end: resolve a point through offsetFromViewportPoint or caretOffsetAtPoint (browser/point.ts)',
		hits: [
			'const r = document.caretRangeFromPoint(x, y);',
			'const p = (doc as any).caretPositionFromPoint?.(x, y);',
			inBrowser('const r = document.caretRangeFromPoint(x, y);')
		],
		misses: [
			'const offset = offsetFromViewportPoint(el, x, y);',
			'const at = browserCaretAtPoint(document, x, y);',
			'// never call caretRangeFromPoint here\nconst a = 1;',
			at(SOURCE.pointLookup, 'const r = document.caretRangeFromPoint(x, y);')
		]
	},
	{
		id: 'G4.270 the browser is asked for the element at a point only in browser/point.ts',
		population: except(SOURCE.pointLookup),
		matches: /\belements?FromPoint\b/,
		mustMatch: [SOURCE.pointLookup],
		reaches: [SOURCE.blockHitTest, SOURCE.editorDomStubs, SOURCE.tableCell],
		reason:
			'jsdom has no element lookup, and every caller needs the same answer there: ask elementAtPoint (browser/point.ts)',
		hits: [
			'const el = document.elementFromPoint(x, y);',
			'const els = el.ownerDocument.elementsFromPoint(x, y);',
			"if (typeof document.elementFromPoint !== 'function') return null;",
			'document.elementFromPoint ??= () => null;',
			inBrowser('const el = doc.elementFromPoint(x, y);')
		],
		misses: [
			'const el = elementAtPoint(root.ownerDocument, x, y);',
			'// the lookup behind elementFromPoint\nconst a = 1;',
			at(SOURCE.pointLookup, 'return doc.elementFromPoint(clientX, clientY);')
		]
	},
	{
		id: 'G4.270 an input event is read only in browser/input.ts',
		population: (file) => notUnder(SOURCE_DIR.debug)(file) && except(SOURCE.inputRead)(file),
		matches:
			/\.\s*inputType\b|\[\s*['"`]inputType['"`]\s*\]|\{[^{}]*\binputType\b[^{}]*\}\s*=[^=>]|\bgetTargetRanges\b/,
		mustMatch: [SOURCE.inputRead],
		reaches: [SOURCE.liveSelectionEdit, SOURCE.typedInput, SOURCE.editableLeaf],
		reason:
			'engines and soft keyboards disagree about which input type a gesture sends, so the editor reads each one once: ask `readInput` (its intent, a shared constant) or `targetRange` in browser/input.ts',
		hits: [
			"if (e.inputType === 'insertText') return;",
			'switch (event.inputType) {}',
			"return e.inputType.startsWith('delete');",
			'const { inputType, data } = e;',
			"const t = e['inputType'];",
			'const target = e.getTargetRanges()[0];',
			"if (typeof e.getTargetRanges === 'function') read();",
			inBrowser("if (e.inputType === 'insertText') return;")
		],
		misses: [
			"if (readInput(e).kind === 'insert') return;",
			'const target = targetRange(e);',
			"el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText' }));",
			'function decidedDelete(e: Pick<InputEvent, typeof INPUT_TYPE>) {}',
			at(SOURCE.inputRead, 'return INTENTS.get(e.inputType) ?? OTHER;'),
			at(`${SOURCE_DIR.debug}probe.ts`, 'const type = e.inputType;')
		]
	},
	{
		id: 'G4.270 whether the IME owns a key or an input is asked only in browser/composition.ts',
		population: (file) =>
			notUnder(SOURCE_DIR.debug)(file) && except(SOURCE.compositionTracker)(file),
		matches: /\bisComposing\b/,
		mustMatch: [SOURCE.compositionTracker],
		reaches: [SOURCE.editableSurface, SOURCE.typedInput, SOURCE.delimiterAutopair],
		reason:
			'engines disagree about when a key is the IME’s (Chromium and WebKit send the key that opens a composition with `isComposing: false`), so the editor asks in one place: `imeOwnsKey` for a key, `imeOwnsInput` for an input, in browser/composition.ts',
		hits: [
			'if (e.isComposing) return;',
			"e: Pick<KeyboardEvent, 'key' | 'isComposing'>",
			'const { isComposing } = e;',
			inBrowser('if (e.isComposing) return;')
		],
		misses: [
			'if (imeOwnsKey(e)) return;',
			'if (imeOwnsInput(e)) return;',
			at(SOURCE.compositionTracker, 'return e.isComposing;'),
			at(`${SOURCE_DIR.debug}probe.ts`, 'const composing = e.isComposing;')
		]
	}
];

describeFileRules(RULES, collectEditorSources());
