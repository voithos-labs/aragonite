// The range-edit laws as one suite over a set of drawn inputs, so each draw (the main one, the HTML
// one) runs every law the same way. Law 3 skips the shapes `laws.ts` declares, each with its reason.

import { describe, expect, it } from 'vitest';
import { editRange, type Gesture, type Range } from '#lib/range-edit/edit-range.js';
import type { Mode } from '#lib/range-edit/host.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { knownResidue } from './known-residue';
import type { LawInput } from './inputs';
import {
	caretLaw,
	copyLaws,
	copyMarkers,
	cutPasteBack,
	deleteLaws,
	dropLaws,
	keepsOutside,
	ownEntry,
	pasteAtCaret,
	pasteAtCutCaret,
	plainPaste,
	replaceLaws,
	type Call,
	type CaretInput,
	type RangeInput
} from './laws';
import { checkHost, testReading, type CheckHost } from './test-host';

/** The core as the laws call it: a throw is a failure of its own, and every caret it hands back
 *  must name a place in its new source (law 8). A copy keeps the selection, so its caret isn't one. */
function calling(host: CheckHost, fails: string[]): Call {
	return (source: string, range: Range, gesture: Gesture, mode: Mode) => {
		const where = JSON.stringify([source, range, gesture, mode]);
		try {
			const result = editRange(source, range, gesture, mode, host);
			if (gesture !== 'copy') fails.push(...caretLaw(host, result, where));
			return result;
		} catch (error) {
			fails.push(`threw on ${where}: ${(error as Error).message}`);
			return undefined;
		}
	};
}

/** At most 20 of `lines`, then how many there were; empty when there are none. */
const report = (lines: string[]) =>
	lines.length === 0 ? '' : `${lines.slice(0, 20).join('\n')}\n(${lines.length} in all)`;

/** Every law over `draw`'s inputs, read once inside the first test that needs them. */
export function describeLaws(
	title: string,
	documents: number,
	draw: (grammar: GrammarView) => LawInput[]
): void {
	describe(title, { timeout: documents * 400 }, () => {
		let inputs: LawInput[] = [];
		let host: CheckHost;
		const setUp = () => {
			const reading = testReading();
			host = checkHost(reading);
			if (inputs.length === 0) inputs = draw(reading.grammar);
		};

		function overRanges(law: (call: Call, input: RangeInput, text: string) => string[]): string {
			setUp();
			const fails: string[] = [];
			const call = calling(host, fails);
			for (const input of inputs) {
				for (const r of input.ranges) {
					const at = { source: input.source, mode: input.mode, range: { from: r.from, to: r.to } };
					const where = `in ${JSON.stringify(input.source)} ${input.mode} [${r.from}, ${r.to})`;
					fails.push(...law(call, at, r.text).map((line) => `${line}\n    ${where}`));
				}
			}
			return report(fails);
		}

		/** A caret law's lines, none where the caret falls under a known class of that law. */
		const undeclared = (i: CaretInput, law: 'L9' | 'L11', lines: string[]) =>
			lines.length > 0 && knownResidue(host, i.source, { from: i.at, to: i.at }, law) ? [] : lines;

		function atCarets(law: (call: Call, input: CaretInput) => string[]): string {
			setUp();
			const fails: string[] = [];
			const call = calling(host, fails);
			for (const input of inputs) {
				for (const c of input.carets) {
					for (const text of c.texts) {
						const at = {
							source: input.source,
							mode: input.mode,
							at: c.at,
							held: { holds: 'text' as const },
							text
						};
						const where = `in ${JSON.stringify(input.source)} ${input.mode} at ${c.at}`;
						fails.push(...law(call, at).map((line) => `${line}\n    ${where}`));
					}
				}
			}
			return report(fails);
		}

		it('L1 and L2: a copy and a cut write one clipboard, and a copy changes nothing', () => {
			expect(overRanges((call, i) => copyLaws(call, i))).toBe('');
		});
		it('L3: a cut pasted back at its caret gives the source back', () => {
			expect(
				overRanges((call, i) => {
					const lines = cutPasteBack(call, host, i);
					return lines.length > 0 && knownResidue(host, i.source, i.range) ? [] : lines;
				})
			).toBe('');
		});
		it('L4: Backspace and Delete leave what a cut leaves, and keep the bytes outside the range', () => {
			expect(
				overRanges((call, i) => {
					const kept = keepsOutside(call, host, i);
					const known = kept.length > 0 && knownResidue(host, i.source, i.range, 'L4');
					return [...deleteLaws(call, i), ...(known ? [] : kept)];
				})
			).toBe('');
		});
		it('L5: a paste, a key, a composition or a command over a range removes as its rule says', () => {
			expect(overRanges((call, i, text) => replaceLaws(call, host, i, text))).toBe('');
		});
		it('L6: a drop moves what a cut takes to where a paste there puts it', () => {
			setUp();
			const fails: string[] = [];
			const call = calling(host, fails);
			for (const input of inputs) {
				for (const r of input.ranges) {
					for (const c of input.carets) {
						if (c.at >= r.from && c.at <= r.to) continue;
						const at = {
							source: input.source,
							mode: input.mode,
							range: { from: r.from, to: r.to }
						};
						fails.push(...dropLaws(call, at, c.at));
					}
				}
			}
			expect(report(fails)).toBe('');
		});
		it('L9: a paste at a caret puts its bytes there', () => {
			expect(atCarets((call, i) => undeclared(i, 'L9', pasteAtCaret(call, host, i)))).toBe('');
		});
		it('L9: a paste at the caret a cut left puts its bytes there', () => {
			expect(
				overRanges((call, i, text) => {
					const lines = pasteAtCutCaret(call, host, i, text);
					return lines.length > 0 && knownResidue(host, i.source, i.range, 'L9') ? [] : lines;
				})
			).toBe('');
		});
		it('L10: a copy carries the markers of the containers it enters or leaves', () => {
			expect(overRanges((call, i) => copyMarkers(call, host, i))).toBe('');
		});
		it('L11: Paste as plain text never converts', () => {
			expect(atCarets((call, i) => undeclared(i, 'L11', plainPaste(call, host, i)))).toBe('');
		});
		it('L12: with its own entry a cut pasted back is exact', () => {
			setUp();
			const fails: string[] = [];
			const call = calling(host, fails);
			for (const input of inputs) {
				for (const r of input.ranges) {
					const at = {
						source: input.source,
						mode: input.mode,
						range: { from: r.from, to: r.to }
					};
					for (const c of input.carets) fails.push(...ownEntry(call, host, at, c.at));
				}
			}
			expect(report(fails)).toBe('');
		});
	});
}
