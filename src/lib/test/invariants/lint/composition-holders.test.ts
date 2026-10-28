/**
 * G4.155: an element wired to `compositionstart` hands it to one of the two composition hosts
 * (the editable surface, the caret host), and both keep the composition in the editor's one
 * tracker (`browser/composition.ts`), which asks about a dropped composition at every signal. A
 * holder of its own composing flag drifts from the browser's, the way four once did.
 */
import { describeFileRules, except, notUnder, type FileRule } from './file-rule';
import { collectEditorSources, type SourceFile } from './scan-source';
import { SOURCE, SOURCE_DIR } from './source-paths';

// A wiring of either event, a type member (`oncompositionstart: () => void;`) left out.
const WIRING =
	/\boncomposition(?:start|end)\s*[=:](?!\s*\(\)\s*=>\s*void\b)|addEventListener\(\s*['"`]composition(?:start|end)['"`]|\bon(?:Root)?\([^)]*['"`]composition(?:start|end)['"`]/g;
const FORWARD = /\b(?:editableSurface|hostInput)\.onComposition(?:Start|End)\b/g;
const count = (code: string, pattern: RegExp) => code.match(pattern)?.length ?? 0;

const outsideTracker = (file: SourceFile): boolean =>
	notUnder(SOURCE_DIR.debug)(file) && except(SOURCE.compositionTracker)(file);

const RULES: FileRule[] = [
	{
		id: 'G4.155 an element wired to a composition event hands it to a composition host',
		population: outsideTracker,
		matches: (file) => count(file.code, WIRING) > count(file.code, FORWARD),
		reaches: [SOURCE.gapCaret, SOURCE.wholeBlockFocusSurface, SOURCE.editableLeaf],
		reason:
			'wire `compositionstart` and `compositionend` to `editableSurface.onCompositionStart`/`End` or a caret host’s (`createCaretHostInput`): they open and end the composition in the editor’s one tracker, which ends a dropped one at any key or input',
		hits: [
			"root.addEventListener('compositionstart', () => (composing = true));",
			'<div oncompositionstart={onStart} oncompositionend={onEnd}></div>',
			"onRoot(deps.root, 'compositionend', () => (composing = false)),",
			'oncompositionstart: editableSurface.onCompositionStart,\noncompositionend: () => (open = false),'
		],
		misses: [
			'<div oncompositionstart={editableSurface.onCompositionStart}></div>',
			"proxy.addEventListener('compositionstart', hostInput.onCompositionStart);",
			'oncompositionstart: () => void;',
			'oncompositionend: () => {\n\teditableSurface.onCompositionEnd();\n\tafterNativeEdit();\n},'
		]
	},
	{
		id: 'G4.155 both composition hosts keep the composition in the tracker',
		population: (file) =>
			file.relPath === SOURCE.editableSurface || file.relPath === SOURCE.caretHostInput,
		matches: (file) =>
			!/\bcomposition\.start\(/.test(file.code) ||
			!/\bcomposition\.adopt\(/.test(file.code) ||
			!/\bcomposition\.end\(/.test(file.code),
		reaches: [SOURCE.editableSurface, SOURCE.caretHostInput],
		atLeast: 2,
		reason:
			'a host opens its composition at its start (`start`), at a composed run when a range across blocks claimed the start (`adopt`), and ends it at its compositionend (`end`)',
		hits: [
			{ relPath: SOURCE.caretHostInput, code: 'composition.start(owner); composition.end(owner);' }
		],
		misses: [
			{
				relPath: SOURCE.caretHostInput,
				code: 'composition.start(owner); composition.adopt(e, owner); composition.end(owner);'
			}
		]
	},
	{
		id: 'G4.155 no composing flag outside the tracker',
		population: outsideTracker,
		matches: /\blet\s+(?:is)?[cC]omposing\b|\b[cC]omposing\s*=\s*\$state\b/,
		allowed: {
			'src/lib/components/blocks/placeholder-hint.svelte.ts':
				'the hint’s reactive copy, written only from its subscription to the tracker'
		},
		reaches: [SOURCE.editableSurface, SOURCE.textBlockComponent, SOURCE.codeBlockComponent],
		reason:
			'a flag of its own drifts from the browser when a composition drops: read the tracker (`openIn`, `live`, or the editable surface’s `composing()`)',
		hits: ['let composing = false;', 'let composing = $state(false);', 'let isComposing = true;'],
		misses: ['const composing = (): boolean => deps.composition.openIn(deps.getEl());']
	}
];

describeFileRules(RULES, collectEditorSources());
