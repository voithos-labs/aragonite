/** `mark`: a plugin's rich-text mark, a run of one character that pairs like `~~` and edits like `**`. */
import { isBuiltInTrigger } from '../core/inline/scan/plugin-syntax';
import { checkLocalName } from './block-shapes';
import { madeInline, type Inline } from './inline-type';
import type { InlineType } from './doc-view';
import { command, type Chord, type Command } from './plugin-command';

/** What `mark` takes. */
export interface MarkSpec {
	/** Lowercase letters, digits and hyphens. */
	name: string;
	label: string;
	/** The run on each side (`==`): one character, repeated; a run of another length stays text. */
	marker: string;
	/** The mark it nests inside when several are written at once; with none, just outside code. */
	after?: InlineType;
	/** Required: where the markers are hidden, a letter typed at the mark's edge joins it, so the
	 *  chord is the only way out of it there. */
	chord: Chord;
	/** The element its text is drawn in; `span` by default. */
	tag?: string;
	class?: string;
	/** Bytes the mark reads, for the published checks. */
	sample: string | readonly string[];
}

/** A mark as a plugin lists it in `Contribution.inlines`; `toggle` is the command its chord runs. */
export interface Mark extends Inline<never> {
	readonly toggle: Command<void>;
}

/** Makes a mark: its runs pair like `~~`, exact length, and it edits like `**` in live mode. */
export function mark(spec: MarkSpec): Mark {
	checkLocalName('mark', spec.name);
	const refuse = (why: string): never => {
		throw new Error(`mark '${spec.name}': ${why}`);
	};
	const { marker } = spec;
	const char = marker[0] ?? '';
	if (!char || [...marker].some((c) => c !== char)) refuse('the marker is one character, repeated');
	if (isBuiltInTrigger(char) || /[\s\p{L}\p{N}]/u.test(char)) {
		refuse(`"${char}" can't open a mark: the editor reads it itself, or it's a letter or a space`);
	}
	if (!spec.chord) refuse('needs a chord, the way out of the mark at its edge');
	const toggle = command({
		id: `toggle-${spec.name}`,
		title: spec.label,
		chord: spec.chord,
		// The editor runs a mark's toggle as it runs Mod+B, so this is never reached.
		run: () => false
	});
	const made = madeInline<never>({
		local: spec.name,
		label: spec.label,
		prefix: char,
		after: spec.after ? [spec.after] : [],
		pair: false,
		split: 'whole',
		claim: () => null,
		widget: null,
		className: null,
		mark: { marker, tag: spec.tag ?? 'span', className: spec.class ?? null, toggle }
	});
	return Object.assign(made, { toggle });
}
