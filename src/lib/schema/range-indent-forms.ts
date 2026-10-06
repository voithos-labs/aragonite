/**
 * What an indent command does over a selection that spans blocks, registered per kind and command
 * by the kind that binds it. A lines form rewrites the lines the selection covers in a leaf's own
 * text; an item form moves the list item holding the covered text one level.
 */
import type { AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { AnyCommandId } from './command-id';
import type { PluginActivation } from './plugin-activation';
import { createPluginRegistry } from './plugin-registry';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';
import { devWarn } from '../dev-warn';

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Shifts the lines `range` covers in `node`'s text (its raw less the final line ending) one step,
 * returning the new text and where the range sits in it; null when no line changes.
 */
export type RangeLineShift = (
	node: NodeView,
	range: { start: number; end: number }
) => { text: string; selection: { start: number; end: number } } | null;

export type RangeIndentForm = { lines: RangeLineShift } | { item: 'nest' | 'lift' };

/**
 * Lets `command`, bound to an indent key in `kind`'s keymap, indent over a selection spanning
 * blocks: `shift` rewrites the lines the selection covers in each block of `kind` it reaches.
 */
export function registerRangeIndent(
	kind: AnyBlockKind,
	command: AnyCommandId,
	shift: RangeLineShift
): void {
	// A range indent reads a lines form at the leaf holding the text, never at a container.
	if (tryGetBlockKindDescriptor(kind)?.isContainer) {
		devWarn(
			'registry',
			`registerRangeIndent: "${kind}" is a container, so this form is never read`
		);
	}
	forms.register(
		keyOf(kind, command),
		{ command, form: { lines: shift } },
		conflict(kind, command)
	);
}

/** A built-in kind's form, kept by the test reset. */
export function registerBuiltInRangeIndent(
	kind: AnyBlockKind,
	command: AnyCommandId,
	form: RangeIndentForm
): void {
	forms.registerCore(keyOf(kind, command), { command, form }, conflict(kind, command));
}

export function rangeIndentForm(
	kind: AnyBlockKind,
	command: AnyCommandId | null,
	activation: PluginActivation
): RangeIndentForm | null {
	if (command === null) return null;
	return forms.get(keyOf(kind, command), activation)?.form ?? null;
}

/** Every command some kind gives a range form, so a key bound to none skips the range walk. */
export function rangeIndentCommands(activation: PluginActivation): Set<AnyCommandId> {
	return new Set(forms.entries(activation).map(([, entry]) => entry.command));
}

// ── Internal ───────────────────────────────────────────────────────────────

interface FormEntry {
	command: AnyCommandId;
	form: RangeIndentForm;
}

const forms = createPluginRegistry<string, FormEntry>({
	label: 'registerRangeIndent',
	isBuiltin: () => false
});

const keyOf = (kind: AnyBlockKind, command: AnyCommandId): string => `${kind} ${command}`;

const conflict = (kind: AnyBlockKind, command: AnyCommandId): string =>
	`registerRangeIndent: (${kind}, ${command}) is already registered. Registrations are register-once.`;
