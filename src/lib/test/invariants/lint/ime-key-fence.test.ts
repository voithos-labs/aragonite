/**
 * G4.273: every keydown handler that runs a command asks `imeOwnsKey` first (`browser/composition.ts`),
 * since a key the IME owns, the one that opens a composition included, is never a command. A file
 * wiring more keydown listeners than it asks about either hands them to a handler that asks or is
 * listed below with why its listener runs no command.
 */
import { describe, expect, it } from 'vitest';
import { collectEditorSources, type SourceFile } from './scan-source';
import { SOURCE, SOURCE_DIR } from './source-paths';
import { notUnder, under } from './file-rule';

// A keydown wiring: an attribute or prop (a type member left out), a listener, or a list of types.
const WIRING =
	/\bonkeydown(?:capture)?\s*[=:](?!\s*\((?:\w+\s*:\s*KeyboardEvent)?\)\s*=>\s*(?:void|Promise)\b)|addEventListener\(\s*['"`]keydown['"`]|\bon(?:Root)?(?:<\w+>)?\(\s*[^,()]+,\s*['"`]keydown['"`]|\[\s*['"`]keydown['"`]/g;
const FENCE = /\bimeOwnsKey\(/g;
const count = (code: string, pattern: RegExp) => code.match(pattern)?.length ?? 0;

/** Wirings each file hands to a handler that asks in another file, or runs no command at all. */
const UNFENCED: Record<string, { wirings: number; why: string }> = {
	'src/lib/components/blocks/code/CodeBlock.svelte': {
		wirings: 1,
		why: 'the editable surface’s onKeyDown'
	},
	'src/lib/components/blocks/table/TableCellBlock.svelte': {
		wirings: 1,
		why: 'the editable surface’s onKeyDown'
	},
	'src/lib/components/blocks/text/TextEditableBlock.svelte': {
		wirings: 1,
		why: 'the editable surface’s onKeyDown'
	},
	'src/lib/components/blocks/editable/editable-leaf.ts': {
		wirings: 1,
		why: 'the source element’s onkeydown is the editable surface’s onKeyDown'
	},
	'src/lib/components/blocks/directive/DirectiveContainerBlock.svelte': {
		wirings: 1,
		why: 'the container factory’s handleKeydown (`editor-actions/plugin/container.ts`)'
	},
	'src/lib/components/dom-block-view/DomBlockView.svelte': {
		wirings: 1,
		why: 'the container factory’s handleKeydown'
	},
	'src/lib/components/Editor.svelte': {
		wirings: 1,
		why: 'the editor root’s keydown handler (`components/editor-root/keydown.ts`)'
	},
	'src/lib/caret/drawn-caret.svelte.ts': {
		wirings: 1,
		why: 'arms the next frame’s paint, which the IME’s own caret move needs too'
	},
	'src/lib/components/editor-root/gestures.ts': {
		wirings: 1,
		why: 'forgets the right-click a key follows'
	},
	'src/lib/components/editor-root/listeners.ts': {
		wirings: 3,
		why: 'the modifier-held attribute, the undo step any input ends, and the held scroll a key releases'
	},
	'src/lib/components/image/ImageProperties.svelte': {
		wirings: 1,
		why: 'the crop’s guard, which keeps every key that would write over the image off it, the IME’s too'
	},
	'packages/admonitions/src/AdmonitionBlock.svelte': {
		wirings: 1,
		why: 'the container factory’s handleKeydown'
	},
	'packages/mermaid/src/MermaidBlock.svelte': {
		wirings: 1,
		why: 'the container factory’s handleKeydown'
	}
};

interface Fence {
	relPath: string;
	wirings: number;
	fences: number;
}

function unfencedIn(files: Pick<SourceFile, 'relPath' | 'code'>[]): Fence[] {
	return files
		.map((f) => ({
			relPath: f.relPath,
			wirings: count(f.code, WIRING),
			fences: count(f.code, FENCE)
		}))
		.filter((f) => f.wirings > f.fences + (UNFENCED[f.relPath]?.wirings ?? 0));
}

describe('G4.273 every keydown handler that runs a command asks imeOwnsKey first', () => {
	const sources = collectEditorSources().filter(
		(f) =>
			under(SOURCE_DIR.library, SOURCE_DIR.plugins)(f) &&
			notUnder(SOURCE_DIR.debug)(f) &&
			f.relPath !== SOURCE.compositionTracker
	);

	it('no file wires more keydown handlers than it fences or lists', () => {
		expect(
			unfencedIn(sources),
			'start the handler with `if (imeOwnsKey(e)) return;` (browser/composition.ts), or list a listener that runs no command in UNFENCED with why'
		).toEqual([]);
	});

	it('every listed file still wires what it lists', () => {
		const stale = Object.entries(UNFENCED)
			.filter(([relPath, entry]) => {
				const file = sources.find((f) => f.relPath === relPath);
				return !file || count(file.code, WIRING) - count(file.code, FENCE) < entry.wirings;
			})
			.map(([relPath]) => relPath);
		expect(stale).toEqual([]);
	});

	it('the matcher counts each wiring shape and leaves a type member alone', () => {
		const probe = (code: string) => unfencedIn([{ relPath: 'probe.ts', code }]);
		for (const code of [
			'<div onkeydown={onKeyDown}></div>',
			'onkeydown: (e) => dispatchChord(e),',
			"el.addEventListener('keydown', onKey, true);",
			"onRoot(document, 'keydown', onKey),",
			"onRoot<KeyboardEvent>(deps.root, 'keydown', (e) => run(e)),",
			"['keydown', 'beforeinput'].map((type) => onRoot(win, type, handler));"
		]) {
			expect(probe(code), code).toHaveLength(1);
		}
		expect(probe('onkeydown: (e: KeyboardEvent) => void;')).toEqual([]);
		expect(
			probe(
				'<div onkeydown={onKeyDown}></div>\nfunction onKeyDown(e) { if (imeOwnsKey(e)) return; }'
			)
		).toEqual([]);
		expect(probe("el.removeEventListener('keydown', onKey, true);")).toEqual([]);
	});
});
