/**
 * G4.273: every keydown handler that runs a command asks `neverACommand` first
 * (`browser/composition.ts`), since a key the IME owns and a key event naming no key are never a
 * command. A bundled plugin asks the `imeOwnsKey` the plugin entry point exports. A file wiring
 * more keydown listeners than it asks about either hands them to a handler that asks or is listed
 * below with why its listener runs no command.
 */
import { describe, expect, it } from 'vitest';
import { collectEditorSources, type SourceFile } from './scan-source';
import { SOURCE, SOURCE_DIR } from './source-paths';
import { notUnder, under } from './file-rule';

// A keydown wiring: an attribute or prop (a type member left out), a listener, or a list of types.
const WIRING =
	/\bonkeydown(?:capture)?\s*[=:](?!\s*\((?:\w+\s*:\s*KeyboardEvent)?\)\s*=>\s*(?:void|Promise)\b)|addEventListener\(\s*['"`]keydown['"`]|\bon(?:Root)?(?:<\w+>)?\(\s*[^,()]+,\s*['"`]keydown['"`]|\[\s*['"`]keydown['"`]/g;
const EDITOR_FENCE = /\bneverACommand\(/g;
const PLUGIN_FENCE = /\bimeOwnsKey\(/g;
const fenceIn = (file: Pick<SourceFile, 'relPath'>) =>
	file.relPath.startsWith(SOURCE_DIR.plugins) ? PLUGIN_FENCE : EDITOR_FENCE;
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

/** The editor's own files that ask `imeOwnsKey` alone, where an IME key and one naming no key part. */
const IME_ONLY: Record<string, string> = {
	'src/lib/components/editor-root/key-claims.ts':
		'claims an IME key in the editor for the IME, and leaves a key naming none'
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
			fences: count(f.code, fenceIn(f))
		}))
		.filter((f) => f.wirings > f.fences + (UNFENCED[f.relPath]?.wirings ?? 0));
}

describe('G4.273 every keydown handler that runs a command asks neverACommand first', () => {
	const sources = collectEditorSources().filter(
		(f) =>
			under(SOURCE_DIR.library, SOURCE_DIR.plugins)(f) &&
			notUnder(SOURCE_DIR.debug)(f) &&
			f.relPath !== SOURCE.compositionTracker
	);

	it('no file wires more keydown handlers than it fences or lists', () => {
		expect(
			unfencedIn(sources),
			'start the handler with `if (neverACommand(e)) return;` (browser/composition.ts; `imeOwnsKey` in a bundled plugin), or list a listener that runs no command in UNFENCED with why'
		).toEqual([]);
	});

	// The count above trusts a forward, so a handler asking only the IME's question is caught here
	// wherever it stands.
	it('the editor asks imeOwnsKey alone only where it lists why', () => {
		const alone = sources
			.filter((f) => !f.relPath.startsWith(SOURCE_DIR.plugins) && count(f.code, PLUGIN_FENCE) > 0)
			.map((f) => f.relPath)
			.sort();
		expect(alone, 'ask `neverACommand`, which skips a key event naming no key too').toEqual(
			Object.keys(IME_ONLY).sort()
		);
	});

	it('every listed file still wires what it lists', () => {
		const stale = Object.entries(UNFENCED)
			.filter(([relPath, entry]) => {
				const file = sources.find((f) => f.relPath === relPath);
				return !file || count(file.code, WIRING) - count(file.code, fenceIn(file)) < entry.wirings;
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
		const fenced = (fence: string) =>
			`<div onkeydown={onKeyDown}></div>\nfunction onKeyDown(e) { if (${fence}(e)) return; }`;
		expect(probe(fenced('neverACommand'))).toEqual([]);
		// The IME's question alone lets a keydown naming no key through to the editor's handlers.
		expect(probe(fenced('imeOwnsKey'))).toHaveLength(1);
		expect(
			unfencedIn([{ relPath: `${SOURCE_DIR.plugins}probe.svelte`, code: fenced('imeOwnsKey') }])
		).toEqual([]);
		expect(probe("el.removeEventListener('keydown', onKey, true);")).toEqual([]);
	});
});
