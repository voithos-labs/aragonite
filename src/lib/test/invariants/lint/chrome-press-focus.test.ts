/**
 * G4.224: a press on editor chrome takes no focus. Engines differ on where a pressed button puts it,
 * so every button (`<button>` or `role="button"`) in a component or a bundled plugin's view sits under
 * a mousedown or pointerdown handler that prevents the default, or its file is listed below as owning
 * focus on purpose
 * (`docs/design/editor.md` § Browser engines).
 */

import { parse } from 'svelte/compiler';
import { describeFileRules, svelteOnly, under, type FileRule } from './file-rule';
import { collectEditorSources, type SourceFile } from './scan-source';
import { SOURCE, SOURCE_DIR } from './source-paths';

const PRESS_EVENTS = new Set(['mousedown', 'pointerdown']);

interface Node {
	type?: string;
	name?: string;
	data?: string;
	attributes?: Node[];
	value?: Node | Node[] | true;
	expression?: Node;
	modifiers?: string[];
	id?: Node;
	init?: Node;
	declarations?: Node[];
	callee?: Node;
	property?: Node;
}

/** Whether the AST under `value` calls `.preventDefault()`; a comment or a bare mention doesn't count. */
function callsPreventDefault(value: unknown): boolean {
	if (value === null || typeof value !== 'object') return false;
	if (Array.isArray(value)) return value.some(callsPreventDefault);
	const node = value as Node;
	if (
		node.type === 'CallExpression' &&
		node.callee?.type === 'MemberExpression' &&
		node.callee.property?.name === 'preventDefault'
	) {
		return true;
	}
	return Object.values(node).some(callsPreventDefault);
}

/** The function `name` declared at the top of the component's script, or null. */
function declaredFunction(script: Node[], name: string): Node | null {
	for (const statement of script) {
		if (statement.type === 'FunctionDeclaration' && statement.id?.name === name) return statement;
		const declarator = statement.declarations?.find((d) => d.id?.name === name);
		if (declarator?.init) return declarator.init;
	}
	return null;
}

function preventsPress(attribute: Node, script: Node[]): boolean {
	if (attribute.type === 'OnDirective') {
		return (
			PRESS_EVENTS.has(attribute.name ?? '') && !!attribute.modifiers?.includes('preventDefault')
		);
	}
	const event = attribute.name?.startsWith('on') ? attribute.name.slice(2) : '';
	if (attribute.type !== 'Attribute' || !PRESS_EVENTS.has(event)) return false;
	if (typeof attribute.value !== 'object') return false;
	const handler = (Array.isArray(attribute.value) ? attribute.value[0] : attribute.value)
		?.expression;
	if (!handler) return false;
	return callsPreventDefault(
		handler.type === 'Identifier' ? declaredFunction(script, handler.name ?? '') : handler
	);
}

/** A `<button>`, or any element with a static `role="button"`. */
function isButton(node: Node): boolean {
	if (node.name === 'button') return true;
	const role = node.attributes?.find((a) => a.type === 'Attribute' && a.name === 'role')?.value;
	return Array.isArray(role) && role.length === 1 && role[0].data === 'button';
}

/** Whether some button in the markup has no element, itself included, that prevents a press. */
function buttonTakesFocus(file: SourceFile): boolean {
	const ast = parse(file.code, { modern: true });
	const script = (ast.instance?.content.body ?? []) as unknown as Node[];
	let found = false;
	const walk = (value: unknown, guarded: boolean): void => {
		if (found || value === null || typeof value !== 'object') return;
		if (Array.isArray(value)) {
			for (const item of value) walk(item, guarded);
			return;
		}
		const node = value as Node;
		let inner = guarded;
		if (node.type === 'RegularElement') {
			inner = guarded || (node.attributes ?? []).some((a) => preventsPress(a, script));
			if (isButton(node) && !inner) {
				found = true;
				return;
			}
		}
		for (const [key, child] of Object.entries(node)) {
			if (key !== 'attributes') walk(child, inner);
		}
	};
	walk(ast.fragment, false);
	return found;
}

const svelteProbe = (code: string) => ({ relPath: `${SOURCE_DIR.components}Probe.svelte`, code });

const CHROME_PRESS_FOCUS: FileRule = {
	id: 'G4.224 a press on editor chrome takes no focus',
	population: (file) => svelteOnly(file) && under(SOURCE_DIR.components, SOURCE_DIR.plugins)(file),
	matches: buttonTakesFocus,
	allowed: {
		'src/lib/components/SearchBar.svelte':
			'the find bar holds focus while open and puts the caret back through `selection/caret-restore.ts`',
		'src/lib/components/link-card/LinkCard.svelte':
			'the link card holds focus in its field and gives the caret back through `selection/caret-restore.ts`',
		'src/lib/components/blocks/table/TableActionMenu.svelte':
			'an ARIA menu with roving focus, which Escape returns to the cell it opened from',
		'packages/toc/src/TocBlock.svelte':
			'its entries are real buttons for tab order and Enter, and a press moves the caret to the heading'
	},
	reason:
		'an engine decides where a pressed button puts focus, and focus off the caret block loses the editor its keys: prevent the default on mousedown at the chrome root (`onmousedown={(e) => e.preventDefault()}`, as the selection toolbar does), or, for chrome that holds focus on purpose, list the file here with where it gives focus back',
	reaches: [SOURCE.imageProperties, SOURCE.tableBlock],
	hits: [
		svelteProbe('<div class="bar"><button>x</button></div>'),
		svelteProbe('<button onclick={go}>x</button>'),
		svelteProbe('<div onmousedown={(e) => e.stopPropagation()}><button>x</button></div>'),
		svelteProbe(
			'<script>function keep(e) { e.stopPropagation(); }</script><div onmousedown={keep}><button>x</button></div>'
		),
		svelteProbe('<button onmousedown={(e) => e.preventDefault()}>a</button><button>b</button>'),
		svelteProbe('{#if open}<span><button>x</button></span>{/if}'),
		svelteProbe(
			'<script>const keep = (e) => e.stopPropagation();\nfunction other(e) { e.preventDefault(); }</script><div onmousedown={keep}><button>x</button></div>'
		),
		svelteProbe(
			'<script>function keep(e) { /* no preventDefault() here */ e.stopPropagation(); }</script><div onmousedown={keep}><button>x</button></div>'
		),
		svelteProbe('<div role="button" tabindex="-1" onclick={go}>x</div>')
	],
	misses: [
		svelteProbe('<button onmousedown={(e) => e.preventDefault()}>x</button>'),
		svelteProbe(
			'<div onpointerdown={(e) => e.preventDefault()}>{#each xs as x}<button>{x}</button>{/each}</div>'
		),
		svelteProbe(
			'<script>function keep(e) { if (e.button === 0) e.preventDefault(); }</script><div onmousedown={keep}><button>x</button></div>'
		),
		svelteProbe('<div class="bar"><span>no buttons</span></div>')
	]
};

describeFileRules([CHROME_PRESS_FOCUS], collectEditorSources());
