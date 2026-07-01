/**
 * `:::note` fenced-div callout — a plugin container kind built on the public
 * registration seams, extended by the Fork-A spike to carry an editable
 * reserved-child-0 "title" leaf (`note-title`). Dev/e2e harness only.
 *
 * The title lives in the opener line (`:::note My Title`) yet is a real CST
 * child at index 0, so `strip(raw) !== serialize(children)`. That is why the
 * callout declares an `'opaque'` container contract: `raw` is authoritative
 * (not a strip-decomposition), exempt from `checkStaleRaw`'s byte-level guard.
 * `rebuildRaw` re-emits the title into the opener line from child 0.
 */

import {
	declarePluginKind,
	registerBlockKind,
	registerBlockOpener,
	registerChromeLeaf,
	isBlockKindRegistered,
	setPluginMetadata,
	getPluginMetadata
} from '$lib/plugin';
import { parse } from '$lib/core/parser';
import { concatChildren } from '$lib/core/serializer';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { KeyBinding } from '$lib/schema/keybindings';
import type { AnyBlockKind, CstNode } from '$lib/core/nodes';

export const NOTE = 'note';
export const NOTE_TITLE = 'note-title';

// Opener line: `:::type` with an optional title after the type word. The title
// group is trimmed of surrounding whitespace by the `[ \t]+ … \S … [ \t]*$` shape.
const OPEN = /^:::(\w+)(?:[ \t]+(.*\S))?[ \t]*$/;
const CLOSE = /^:::\s*$/;

interface CalloutMetadata {
	calloutType: string;
}

// The title runs on the `registerChromeLeaf` surface (TextEditableBlock); this
// keymap is what that surface's runCommand can execute. Enter → `block.split` is
// a deliberate, characterized choice: it splits the title into two rows. A
// "descend into the body" Enter would need a plugin-minted command (the closed
// CommandId union forbids it today). No `format.toggle*` chords: the chrome leaf
// is `supportsInline: false`, so those commands would insert literal `**`/`*` — a
// keymap must not advertise commands the render path can't honor.
const TITLE_KEYMAP: KeyBinding[] = [
	{ chord: 'Enter', command: 'block.split' },
	{ chord: 'Backspace', command: 'block.mergePrev' },
	{ chord: 'Delete', command: 'block.mergeNext' }
];

function makeTitleChild(text: string): CstNode {
	return { kind: NOTE_TITLE as AnyBlockKind, leadingTrivia: '', raw: text ? `${text}\n` : '\n' };
}

/**
 * Reconstruct `raw` from children after a structural edit. Child 0 is the title
 * (emitted into the opener line); children 1+ are the fenced body. Invoked by
 * the commit primitive whenever the callout's children mutate.
 */
export function rebuildCalloutRaw(node: CstNode): void {
	const type = getPluginMetadata<CalloutMetadata>(node)?.calloutType ?? NOTE;
	const children = node.children ?? [];
	const titleText = children[0] ? trimTrailingLineEnding(children[0].raw) : '';
	const body = children.slice(1);
	const inner = (node.innerPrefix ?? '') + concatChildren(body) + (node.innerSuffix ?? '');
	const opener = titleText ? `:::${type} ${titleText}` : `:::${type}`;
	node.raw = `${opener}\n${inner}:::\n`;
}

export function registerCalloutKind(): void {
	if (isBlockKindRegistered(NOTE)) return; // idempotent for HMR / re-import
	const note = declarePluginKind(NOTE);
	const noteTitle = declarePluginKind(NOTE_TITLE);

	registerBlockKind(note, {
		mergeRole: 'container',
		editable: true,
		isContainer: true,
		supportsInline: false,
		// Child-0 chrome puts the title in the opener line, breaking
		// `strip(raw) === serialize(children)`. `'opaque'` marks raw authoritative
		// and exempts the container from checkStaleRaw's byte-check.
		containerContract: 'opaque',
		rebuildRaw: rebuildCalloutRaw,
		unwrapRole: { firstChildBackspace: 'lift-first-child', middleChildBackspace: 'default-merge' }
	});

	// Reserved-child-0 chrome via the public seam: no `$lib` component import, and
	// the leaf is kind-sticky (contextDependentKind) so typing keeps `note-title`.
	registerChromeLeaf(noteTitle, { blockClass: 'note-title', keymap: TITLE_KEYMAP });

	registerBlockOpener(note, {
		priority: 45, // between blockquote (40) and list (50); ::: is claimed by no built-in
		interruptsParagraph: (line) => OPEN.test(line),
		tryOpen(ctx) {
			const opener = ctx.line.text.match(OPEN);
			if (!opener) return null;

			let i = ctx.index + 1;
			while (i < ctx.end && !CLOSE.test(ctx.lines[i].text)) i++;
			if (i >= ctx.end) return null; // unterminated fence declines to paragraph

			const bodyText = ctx.lines
				.slice(ctx.index + 1, i)
				.map((l) => l.raw)
				.join('');
			const body = parse(bodyText);
			const raw = ctx.lines
				.slice(ctx.index, i + 1)
				.map((l) => l.raw)
				.join('');

			const node: CstNode = {
				kind: note,
				leadingTrivia: ctx.leadingTrivia,
				raw,
				innerPrefix: body.prefix,
				children: [makeTitleChild(opener[2] ?? ''), ...body.children],
				innerSuffix: body.suffix
			};
			setPluginMetadata<CalloutMetadata>(node, { calloutType: opener[1] });
			return { node, nextIndex: i + 1 };
		}
	});
}
