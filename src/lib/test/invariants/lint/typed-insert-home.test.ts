/**
 * G4.274: where typed text lands is decided in one place, `components/blocks/editable/typed-insert.ts`,
 * by key or soft keyboard, so an engine that puts a letter away from the caret is fixed once
 * (`docs/design/editor.md` § Browser engines). The other readers of a typed insert are a short list,
 * each with its reason.
 */

import { describeFileRules, notUnder, under, type FileRule, type Probe } from './file-rule';
import { collectEditorSources, type SourceFile } from './scan-source';
import { SOURCE, SOURCE_DIR } from './source-paths';

const inLibrary = (code: string): Probe => ({ relPath: `${SOURCE_DIR.library}probe.ts`, code });

const inShippedEditor = (file: SourceFile): boolean =>
	under(SOURCE_DIR.library)(file) && notUnder(SOURCE_DIR.debug)(file);

const RULES: FileRule[] = [
	{
		id: 'G4.274 the typed-insert intent is read only where a typed insert is decided',
		population: inShippedEditor,
		// An input's intent read off `readInput`, kept in a local, or compared straight.
		matches:
			/(?:\breadInput\([^)]*\)\.kind|\bread\.kind|(?<![.\w$])kind)\s*[!=]==\s*['"`]insert['"`]/,
		allowed: {
			[SOURCE.typedInsert]: 'the one decision on where a collapsed typed insert lands',
			[SOURCE.delimiterAutopair]:
				'a delimiter typed at a caret writes its pair, before the decision',
			[SOURCE.liveSelectionEdit]: 'text typed over a range in live mode rewrites the range',
			[SOURCE.crossBlockDispatch]: 'text typed over a range across blocks replaces the range',
			[SOURCE.caretHostInput]:
				'the gap caret and the whole-block proxy take every input themselves',
			[SOURCE.compositionTracker]: 'a typed insert ends a composition the browser dropped',
			[SOURCE.codeBlockComponent]: 'a code body draws no inline widgets: its own pairs and fences',
			[SOURCE.editableLeaf]: 'a painted source splices what it is typed over its target range'
		},
		reaches: [SOURCE.typedInsert],
		reason:
			'where a typed letter lands is the typing decision’s (`decideTypedInsert` in components/blocks/editable/typed-insert.ts): add the case there, or allow the file here with the reason it reads a typed insert at all',
		hits: [
			"if (readInput(e).kind !== 'insert') return;",
			"const typing = read.kind === 'insert';",
			"return (kind === 'insert' || kind === 'replace') && open;"
		].map(inLibrary),
		misses: [
			"if (row.action.kind === 'insert') return row.action.build(argument).detail;",
			"if (change.op === 'insert') count++;",
			"if (readInput(e).kind === 'break') return;"
		].map(inLibrary)
	},
	{
		id: 'G4.274 a typed key is written only where a typed insert is decided',
		population: inShippedEditor,
		matches: /\bisPlainTypingKey\s*\(/,
		allowed: {
			[SOURCE.typedInsert]: 'the keydown half of the one decision',
			[SOURCE.clickSnapGuard]: 'the definition',
			[SOURCE.edgePolicyDispatch]: 'a key typed over a range that opens at a widget replaces it',
			[SOURCE.widgetInteraction]: 'a widget selected whole takes the key, through the same splice',
			[SOURCE.pendingBreakKeys]: 'the line Shift+Enter opened writes its own first letter',
			[SOURCE.imageProperties]: 'a field in the image dialog keeps its own keys, writing nothing'
		},
		reaches: [SOURCE.typedInsert],
		reason:
			'where a typed letter lands is the typing decision’s (`decideTypedKey` in components/blocks/editable/typed-insert.ts): add the case there, or allow the file here with the reason it reads a typed key at all',
		hits: ['if (isPlainTypingKey(e)) write(e.key);'].map(inLibrary),
		misses: ['if (isCharacterKey(event.key)) insert(event.key);'].map(inLibrary)
	}
];

describeFileRules(RULES, collectEditorSources());
