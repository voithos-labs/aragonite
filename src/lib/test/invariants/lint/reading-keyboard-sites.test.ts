/**
 * G4.235: in reading mode the page owns Tab, and the editor is one stop in it. A keydown that reads
 * the Tab key by hand skips the dispatcher's reading-mode decline, and an element that puts itself
 * in the tab order skips the reading-mode stop (`docs/design/editor.md` § Browser engines).
 */

import { describeFileRules, under, type FileRule } from './file-rule';
import { collectEditorSources } from './scan-source';
import { SOURCE, SOURCE_DIR } from './source-paths';

const HAND_TAB_SITES: FileRule = {
	id: 'G4.235 a keydown reads the Tab key by hand only where reading mode is settled',
	matches: /(?:\.key|\bchord)\s*[!=]==?\s*['"]Tab['"]|\bcase\s+['"]Tab['"]/,
	allowed: {
		[SOURCE.crossBlockKeydown]: "the range's Tab, which hands Tab back to the page in reading mode",
		'src/lib/components/blocks/table/TableActionMenu.svelte':
			"the open menu's focus trap; the menu never opens in reading mode",
		[SOURCE.linkCard]: "the open card's focus trap; the card never opens in reading mode",
		[SOURCE.imageProperties]: 'lets Tab through to the page while a crop is open',
		'src/lib/inline-menu/inline-menu-state.svelte.ts':
			'commits the open row; an inline menu never opens in reading mode',
		[SOURCE.mermaidBlock]: "indents in the diagram's edit box, which reading mode never opens"
	},
	reason:
		'a block keydown that takes Tab itself skips the dispatcher, which leaves Tab to the page in reading mode: bind the key in the kind keymap instead',
	reaches: [SOURCE.crossBlockKeydown, SOURCE.linkCard],
	hits: [
		"if (e.key === 'Tab') move();",
		'if (e.key !== "Tab") return;',
		"switch (e.key) { case 'Tab': next(); }",
		"if (chord === 'Tab') commit();"
	],
	misses: [
		"{ chord: 'Tab', command: 'list.indent' }",
		"const label = 'Tab';",
		"if (e.key === 'Tabs') x();"
	]
};

const inLibrary = (code: string) => ({ relPath: `${SOURCE_DIR.library}probe.svelte`, code });

const OWN_TAB_STOPS: FileRule = {
	id: 'G4.235 only a control or the reading-mode stop puts an element in the tab order',
	population: under(SOURCE_DIR.library),
	matches:
		/tabindex\s*[=:]\s*["']?0\b|tabindex=\{[^}]*\b0\b[^}]*\}|tabindex\s*=[^;\n]*[?:]\s*0\b|setAttribute\(\s*["']tabindex["']\s*,\s*["'`]?0\b/i,
	allowed: {
		[SOURCE.readingFocus]: 'the reading-mode stop itself',
		'src/lib/components/blocks/marker-prefix.ts':
			'a marker range a kind declares focusable, a control such as the footnote back marker',
		'src/lib/plugins/footnotes/FootnoteReference.svelte': "the reference, reading mode's link",
		'src/lib/components/GapCaret.svelte': 'the gap caret, which reading mode never shows'
	},
	reason:
		"a block's focus element takes its tabindex from the reading-mode stop (`readingFocus.hold`, through the editable surface's attributes); any other element with a tab stop must be a control",
	reaches: [SOURCE.readingFocus],
	hits: [
		inLibrary('<div tabindex="0" class="x"></div>'),
		inLibrary('<div tabindex={open ? 0 : -1}></div>'),
		inLibrary('const props = { tabindex: 0 };'),
		inLibrary('el.tabIndex = 0;'),
		inLibrary('el.tabIndex = focused ? 0 : -1;'),
		inLibrary('el.tabIndex = reading ? -1 : 0;'),
		inLibrary("el.setAttribute('tabindex', '0');"),
		inLibrary('const props = { tabIndex: 0 };'),
		inLibrary('<div tabIndex="0"></div>')
	],
	misses: [
		inLibrary('<div tabindex="-1"></div>'),
		inLibrary('el.tabIndex = -1;'),
		inLibrary('const tabIndex = 10;'),
		inLibrary("el.setAttribute('tabindex', '-1');")
	]
};

describeFileRules([HAND_TAB_SITES, OWN_TAB_STOPS], collectEditorSources());
