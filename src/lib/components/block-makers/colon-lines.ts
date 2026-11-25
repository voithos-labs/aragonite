/**
 * `colonLines`: the lines of a `:::name` container a maker makes. Listing such a type turns the
 * directive grammar on as `activateDirectives()` does (the generic boxes, `::leaf`, `:text[]`), so a
 * plugin value brings `:::` with it and an app with no colon type ships none of it.
 */
import { READS_LINES, WRITES_LINES, type ColonLines } from '../../core/strip-lines';
import { COLON_LINES } from '../../schema/colon-lines';
import { matchDirectiveOpener, withDirectiveName } from '../../core/directive/grammar';
import { DIRECTIVE_OPENER_LINE } from '../../core/directive/container-shape';
import { activateDirectives } from '../blocks/directive/activate-directives';

/** What `colonLines` takes. */
export interface ColonSpec {
	/** The names after `:::` that open the type, in an editor that lists it. */
	names: readonly string[];
	/** What a screen reader calls the opening line (default "Title"), and a class for its text. */
	title?: { label?: string; className?: string };
}

/** The lines of a `:::name` container: its opening line is its title row, then the body and a
 *  closing line of colons the editor widens past any body line that would close it. */
export function colonLines(spec: ColonSpec): ColonLines {
	const names = [...new Set(spec.names)];
	if (names.length === 0) throw new Error('colonLines: list at least one name');
	for (const name of names) {
		if (matchDirectiveOpener(`:::${name}`)?.name !== name) {
			throw new Error(`colonLines: no \`:::\` line opens with the name "${name}"`);
		}
	}
	return {
		shape: 'colon',
		[WRITES_LINES]: COLON_LINES[WRITES_LINES],
		[READS_LINES]: {
			names,
			row: DIRECTIVE_OPENER_LINE,
			title: { label: spec.title?.label ?? 'Title', className: spec.title?.className },
			openers() {
				activateDirectives();
				return [];
			},
			renamed: withDirectiveName,
			claims(lines) {
				const fence = matchDirectiveOpener(lines[0] ?? '');
				return fence?.tier === 'container' && names.includes(fence.name);
			}
		}
	};
}
