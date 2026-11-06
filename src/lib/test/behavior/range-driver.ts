// Gestures over a range in the mounted editor, a row each: copy and cut by their chords, a paste
// over the range, Backspace, Delete and a typed key. Each gesture gets a fresh mount, and drives
// through the range-edit laws' own event routes, so the two suites read one editor.

import type { PresentationMode } from '#lib/presentation-mode.js';
import type { EditorSelection, SelectionPoint } from '#lib/selection/primitives.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { sitesOf, type Site } from '../range-laws/ranges';
import {
	clipboardGesture,
	deleteGesture,
	mountCase,
	pasteGesture,
	placeRange,
	typeGesture,
	Undetermined,
	type Editor
} from '../range-laws/gestures';
import { caretField, textField, undoField, warnsField, type Row } from './rows';

type RangeGesture =
	| { name: 'copy' | 'cut' }
	| { name: 'Backspace' | 'Delete' }
	| { name: 'type x' }
	| { name: string; paste: string };

const GESTURES: readonly RangeGesture[] = [
	{ name: 'copy' },
	{ name: 'cut' },
	{ name: 'paste text', paste: 'xy' },
	{ name: 'paste blocks', paste: 'one\n\ntwo' },
	{ name: 'Backspace' },
	{ name: 'Delete' },
	{ name: 'type x' }
];

/** The ranges a document's rows run over: each site's whole text, each neighbouring pair from
 *  the middle of one to the middle of the next, and the first site's start to the last's end. */
export async function rangesOf(source: string, mode: PresentationMode): Promise<EditorSelection[]> {
	const editor = mountCase(source, mode);
	await editor.settle();
	const sites = sitesOf(editor.instance.__test.getDocument());
	await editor.destroy();
	takeDevWarns();
	const ranges: EditorSelection[] = [];
	for (const site of sites) {
		if (!site.cells && site.end - site.start >= 2)
			ranges.push({ anchor: point(site, site.start), focus: point(site, site.end) });
	}
	for (let i = 0; i + 1 < sites.length; i++) {
		ranges.push({
			anchor: point(sites[i], middle(sites[i])),
			focus: point(sites[i + 1], middle(sites[i + 1]))
		});
	}
	if (sites.length > 1) {
		const last = sites[sites.length - 1];
		ranges.push({ anchor: point(sites[0], sites[0].start), focus: point(last, last.end) });
	}
	const seen = new Set<string>();
	return ranges.filter((range) => !seen.has(rangeName(range)) && !!seen.add(rangeName(range)));
}

/** A row per gesture over `range`, or one `no range` row when the range won't place. */
export async function rangeRows(
	label: string,
	source: string,
	mode: PresentationMode,
	range: EditorSelection
): Promise<Row[]> {
	const rows: Row[] = [];
	for (const gesture of GESTURES) {
		const editor = mountCase(source, mode);
		await editor.settle();
		takeDevWarns();
		const at = `${label} ${rangeName(range)}`;
		if (!(await placeRange(editor, range))) {
			await editor.destroy();
			rows.push({ in: `${at} *`, took: 'no range', warns: warnsField(tagsTaken()) });
			return rows;
		}
		const { took, clipboard } = await drive(editor, gesture).catch(notReplayed);
		const edited = editor.source();
		const caret = caretOf(editor);
		const { undone, redone } =
			edited === source ? { undone: source, redone: source } : await undoThenRedo(editor);
		await editor.destroy();
		rows.push({
			in: `${at} ${gesture.name}`,
			took,
			bytes: textField(source, edited),
			caret,
			clipboard,
			undo: undoField(source, edited, undone, redone),
			warns: warnsField(tagsTaken())
		});
	}
	return rows;
}

/** A gesture the byte splice couldn't replay (`range-laws/through-splice.ts`), as its row says. */
function notReplayed(error: unknown): { took: string } {
	if (!(error instanceof Undetermined)) throw error;
	return { took: `not replayed: ${error.message}` };
}

async function drive(
	editor: Editor,
	gesture: RangeGesture
): Promise<{ took?: string; clipboard?: string }> {
	if (gesture.name === 'copy' || gesture.name === 'cut') {
		const written = await clipboardGesture(editor, gesture.name, 'key');
		const others = Object.keys(written).filter((type) => type !== 'text/plain');
		const plain = textField('', written['text/plain'] ?? '');
		return { clipboard: others.length ? `${plain} +${others.sort().join(',')}` : plain };
	}
	if ('paste' in gesture) {
		await pasteGesture(editor, { 'text/plain': gesture.paste }, 'key');
		return {};
	}
	if (gesture.name === 'type x') {
		await typeGesture(editor, { text: 'x', route: 'hardware key' });
		return {};
	}
	const key = gesture.name as 'Backspace' | 'Delete';
	return { took: (await deleteGesture(editor, key)) ? undefined : 'browser' };
}

/** The selection, or the gap caret, which the public selection doesn't name. */
function caretOf(editor: Editor): string {
	const gap = editor.instance.__test.getGapCaret();
	if (gap) return `gap [${gap.parentPath.join(',')}]/${gap.index}`;
	return caretField(editor.instance.getSelection());
}

async function undoThenRedo(editor: Editor) {
	editor.instance.runCommand('history.undo');
	await editor.settle();
	const undone = editor.source();
	editor.instance.runCommand('history.redo');
	await editor.settle();
	return { undone, redone: editor.source() };
}

const tagsTaken = () => takeDevWarns().map((record) => record.tag);

function point(site: Site, offset: number): SelectionPoint {
	return site.cells
		? { path: site.path, offset: offset >= site.end ? site.end - 1 : offset, cellCoordinate: true }
		: { path: site.path, offset };
}

const middle = (site: Site) =>
	site.cells ? site.start : site.start + Math.ceil((site.end - site.start) / 2);

const rangeName = ({ anchor, focus }: EditorSelection) =>
	`${caretField({ anchor, focus: anchor })}..${caretField({ anchor: focus, focus })}`;
