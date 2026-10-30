/**
 * The commands a block whose text takes inline constructs runs on itself, shared by a paragraph and
 * a table cell: the format toggles, their pressed state, Edit link, and the one route every command
 * runs through. A command waits for a shown source to be written, then writes as its own undo step.
 */

import { tick } from 'svelte';
import type { NodeView } from '../../../core/node-views';
import type { ContentRange } from '../../../core/inline';
import {
	createInlineFormatActiveMemo,
	toggleInlineFormat
} from '../../../core/inline/format-toggle';
import { inlineMarkForCommand, type InlineMarkKind } from '../../../schema/inline-construct-policy';
import type { CommandId } from '../../../schema/commands';
import type { Reading } from '../../../schema/reading';
import type { SelectionState } from '../../../selection/selection-state.svelte';
import type { UndoController } from '../../../editor-actions/deps';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { asRawOffset } from '../../../core/coordinate-spaces';
import type { RawRange } from '../../../browser/offsets';
import { editTargetAt, enterLinkCardAtCaret } from '../../link-card/link-card-entry';
import type { LinkCardState } from '../../link-card/link-card-state.svelte';
import type { EditableSurface } from '../editable/editable-surface';
import type { SurfaceBackend } from '../editable/surface-backend';
import { withOwnEnding } from '../editable/surface-write';
import type { WidgetInteraction } from './widget-interaction';

export interface InlineCommandsDeps {
	getEl: () => HTMLElement | null;
	get node(): NodeView;
	get index(): number;
	get path(): number[];
	reading: Reading;
	cursor: SurfaceBackend;
	selection: Pick<SelectionState, 'isCrossBlock'>;
	widgets: Pick<WidgetInteraction, 'isRevealing' | 'foldRevealBeforeMutation' | 'enterWidget'>;
	surface: Pick<EditableSurface, 'blockEdit' | 'pendingMarks' | 'insideCloser'>;
	controller: Pick<UndoController, 'flushDebouncedCheckpoint'>;
	linkCard: LinkCardState;
	/** The text a format toggle rewrites, and the part of it that is the block's content. */
	formatText: () => { display: string; content: ContentRange };
	setSelection: (start: number, end: number) => void;
}

export interface InlineCommands {
	/** Whether a button shows as pressed: the same text and selection the toggle itself uses, and
	 *  for the card the same construct its own entry resolves. */
	isCommandActive(id: CommandId): boolean;
	/** `range` is read before the command runs and never again: hiding a shown source collapses the
	 *  live selection. */
	toggleFormat(format: InlineMarkKind, range: RawRange): void;
	/** Edit link at the caret; `selection` is the range a new link would wrap, null where the block
	 *  creates none. */
	enterLinkCard(selection: RawRange | null): void;
	/** Runs `run` once a shown source is closed and its widget drawn again, with the caret parked
	 *  at `offset`. */
	afterSourceCommit(run: () => void, offset?: number): void;
	/** Runs a command's write after any shown source closes, as an undo step of its own. */
	perform(id: CommandId, write: () => void, offset: number): void;
}

export function createInlineCommands(deps: InlineCommandsDeps): InlineCommands {
	const linkCardQuery = (contentEl: HTMLElement, range: RawRange | null) => ({
		contentEl,
		block: deps.node,
		path: deps.path,
		reading: deps.reading,
		selection: range,
		crossBlockRange: deps.selection.isCrossBlock
	});

	// A toolbar asks once per button on every selection change, so the buttons share the parse.
	const formatActive = createInlineFormatActiveMemo();

	function isCommandActive(id: CommandId): boolean {
		const el = deps.getEl();
		if (!el) return false;
		const marked = inlineMarkForCommand(id);
		if (!marked) {
			// The link card is the one pressed state no mark policy answers.
			if (id !== 'link.openCard') return false;
			return editTargetAt(linkCardQuery(el, deps.cursor.getRawSelection())) !== null;
		}
		const caret = deps.cursor.getRaw() ?? 0;
		const selection = deps.cursor.getRawSelection() ?? { start: caret, end: caret };
		return formatActive({ ...deps.formatText(), selection, reading: deps.reading }, marked.kind);
	}

	function toggleFormat(format: InlineMarkKind, range: RawRange): void {
		if (!deps.getEl()) return;
		// Where the markers stay hidden, an empty `****` would be invisible bytes, so the mark waits
		// for the next insertion (`docs/design/live-mode.md` § 4.3).
		if (deps.reading.hidesDelimitersAtCaret() && range.start === range.end) {
			// The insertion that spends the mark starts its own undo entry, so it is never merged
			// into the burst the chord interrupted.
			deps.controller.flushDebouncedCheckpoint();
			deps.surface.pendingMarks.toggle(format);
			return;
		}
		const toggled = toggleInlineFormat(
			{ ...deps.formatText(), selection: range, reading: deps.reading },
			format
		);
		if (!toggled) return;
		const write = deps.surface.blockEdit.updateBlockContent(
			deps.index,
			withOwnEnding(deps.node, toggled.newDisplay),
			'literal',
			'entry',
			range.start,
			toggled.newSelStart
		);
		if (!write.admitted) return;
		// The write may have escaped a byte inside the toggled span, so the far edge is mapped too.
		void tick().then(() => deps.setSelection(write.caret, write.storedOffset(toggled.newSelEnd)));
	}

	function enterLinkCard(selection: RawRange | null): void {
		const el = deps.getEl();
		if (!el) return;
		enterLinkCardAtCaret({
			...linkCardQuery(el, selection),
			card: deps.linkCard,
			enterWidget: deps.widgets.enterWidget,
			placeCaretInText: (offset) => {
				deps.cursor.setRaw(asRawOffset(offset), { clamp: 'exact' });
				deps.surface.insideCloser.open(offset);
			}
		});
	}

	function afterSourceCommit(run: () => void, offset = deps.cursor.getRaw() ?? 0): void {
		if (!deps.widgets.isRevealing()) return run();
		const fold = deps.widgets.foldRevealBeforeMutation(offset);
		void (fold?.settled ?? tick()).then(run);
	}

	function perform(id: CommandId, write: () => void, offset: number): void {
		afterSourceCommit(() => {
			// A command never writes while a source is shown, so a failure means a route skipped
			// closing it (G1.26).
			assertInvariant('reveal-transition', () =>
				deps.widgets.isRevealing()
					? { code: 'command-during-reveal', message: `${id} mutated the block with a reveal open` }
					: null
			);
			write();
		}, offset);
	}

	return { isCommandActive, toggleFormat, enterLinkCard, afterSourceCommit, perform };
}
