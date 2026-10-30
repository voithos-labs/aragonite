/**
 * G4.219: no popover closes on focus leaving. Safari focuses no clicked button, so a close that
 * waits on its opener's blur never comes; menus close through the menu presence instead. Every
 * focus-loss listener left in the library serves a real focus need and is listed with it.
 */

import { describeFileRules, type FileRule } from './file-rule';
import { collectEditorSources } from './scan-source';

const FOCUS_LOSS_LISTENER =
	/\bon(?:focusout|blur)\s*[=:]|\b(?:addEventListener|onRoot)\s*(?:<[^>]*>)?\([^;]*?['"](?:focusout|blur)['"]/;

const FOCUS_LOSS: FileRule = {
	id: 'G4.219 a focus-loss listener serves a focus need, never a popover close',
	matches: FOCUS_LOSS_LISTENER,
	allowed: {
		'src/lib/caret/drawn-caret.svelte.ts': 'the drawn caret repaints as focus leaves its block',
		'src/lib/components/Editor.svelte': 'caret memory forgets as focus leaves the editor',
		'src/lib/components/GapCaret.svelte': 'the gap caret ends as its hidden input loses focus',
		'src/lib/components/blocks/code/CodeBlockRail.svelte':
			'Tab out of the language field or the gutter closes its popout, and the copied label clears as focus leaves',
		'src/lib/components/blocks/placeholder-hint.svelte.ts':
			'the empty-block hint shows on the focused block only',
		'src/lib/components/blocks/table/TableBlock.svelte':
			'the sticky column resets as focus leaves the table',
		'src/lib/components/blocks/table/TableCellBlock.svelte':
			'a shown source commits as its cell loses focus',
		'src/lib/components/blocks/text/TextEditableBlock.svelte':
			'a shown source and a pending line break end as the block loses focus',
		'src/lib/components/blocks/editable/editable-leaf.ts':
			'a shown source commits as its leaf loses focus',
		'src/lib/components/editor-root/focus.ts': 'tracks which block holds focus',
		'src/lib/components/editor-root/listeners.ts':
			'announces the editor losing focus, and ends a press as the window loses it',
		'src/lib/components/menu/InlineMenuHost.svelte':
			'the inline menu session ends as the caret leaves the editor with focus',
		'packages/mermaid/src/MermaidBlock.svelte':
			'the edit box commits as it loses focus, and the pan gesture arms only while focus is inside'
	},
	reason:
		'a popover closes on a press outside it and on Escape through `menuPresence.track` (components/menu/menu-presence.svelte.ts); a close on focus leaving never fires in Safari, which focuses no clicked button',
	hits: [
		'<div onfocusout={close}>',
		'<input onblur={() => (open = false)} />',
		"root.addEventListener('focusout', onFocusOut);",
		"onRoot(window, 'blur', reset)",
		"onRoot<FocusEvent>(root, 'focusout', onFocusOut)",
		'onfocusout: () => close(),'
	],
	misses: ["closeShownSource('blur', null);", '<div onfocusin={arm}>', 'el.blur();']
};

describeFileRules([FOCUS_LOSS], collectEditorSources());
