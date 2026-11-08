/**
 * What an indent command does over a selection that spans blocks, per built-in kind and command.
 * A lines form rewrites the lines the selection covers in a leaf's own text; an item form moves the
 * list item holding the covered text one level.
 */
import type { AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { AnyCommandId } from './command-id';

/**
 * Shifts the lines `range` covers in `node`'s text (its raw less the final line ending) one step,
 * returning the new text and where the range sits in it; null when no line changes.
 */
export type RangeLineShift = (
	node: NodeView,
	range: { start: number; end: number }
) => { text: string; selection: { start: number; end: number } } | null;

export type RangeIndentForm = { lines: RangeLineShift } | { item: 'nest' | 'lift' };

/** A built-in kind's form, set by the bootstrap that knows how the kind shifts its lines. */
export function setBuiltInRangeIndent(
	kind: AnyBlockKind,
	command: AnyCommandId,
	form: RangeIndentForm
): void {
	forms.set(keyOf(kind, command), { command, form });
}

export function rangeIndentForm(
	kind: AnyBlockKind,
	command: AnyCommandId | null
): RangeIndentForm | null {
	return command === null ? null : (forms.get(keyOf(kind, command))?.form ?? null);
}

/** Every command some kind gives a range form, so a key bound to none skips the range walk. */
export function rangeIndentCommands(): Set<AnyCommandId> {
	return new Set([...forms.values()].map((entry) => entry.command));
}

// ── Internal ───────────────────────────────────────────────────────────────

const forms = new Map<string, { command: AnyCommandId; form: RangeIndentForm }>();

const keyOf = (kind: AnyBlockKind, command: AnyCommandId): string => `${kind} ${command}`;
