import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { runDiff } from './differ';
import { enumerateCorpus, sampleCorpus, loadSpecExamples } from './corpus';
import { REFERENCE_VERSION } from './reference';
import baseline from './baseline.json';

// Env-gated so `npm test` skips it in seconds; the controller runs the real
// sweep via `npm run conformance:full`. The report is a divergence meter, not
// a gate — the in-suite guard is the slice ratchet.
const OUTPUT_DIR = 'conformance-results';
const OUTPUT_FILE = `${OUTPUT_DIR}/full-sweep.json`;
const MAX_EXEMPLARS = 5;

interface ClassReport {
	class: string;
	count: number;
	exemplars: string[];
}

describe.skipIf(!process.env.CONFORMANCE_FULL)('conformance full sweep', () => {
	it('writes the classed divergence report over the full corpus', () => {
		// Built inside the test body, not at module scope: enumerateCorpus(5) is
		// ~177k strings, so keeping it here is what lets the skipped run stay fast.
		// Spec markdown is trailing-newline-stripped to match how the slice ratchet
		// pins the baseline, so spec-derived divergences match their baseline class.
		const inputs = [
			...loadSpecExamples().map((example) => example.markdown.replace(/\n$/, '')),
			...enumerateCorpus(5),
			...sampleCorpus(99, 50000, 4, 24)
		];

		const { divergences, compared, skippedNotParagraph, skippedPartialSpan } = runDiff(inputs);

		const classByInput = new Map(baseline.entries.map((entry) => [entry.input, entry.class]));
		const exemplarsByClass = new Map<string, string[]>();
		const unclassified: string[] = [];
		for (const input of new Set(divergences.map((divergence) => divergence.input))) {
			const className = classByInput.get(input);
			if (className === undefined) {
				unclassified.push(input);
				continue;
			}
			const bucket = exemplarsByClass.get(className) ?? [];
			bucket.push(input);
			exemplarsByClass.set(className, bucket);
		}

		const classes: ClassReport[] = [...exemplarsByClass.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([className, classInputs]) => ({
				class: className,
				count: classInputs.length,
				exemplars: classInputs.slice(0, MAX_EXEMPLARS)
			}));

		const report = {
			referenceVersion: REFERENCE_VERSION,
			generatedAt: new Date().toISOString(),
			compared,
			skippedNotParagraph,
			skippedPartialSpan,
			classes,
			unclassified
		};

		mkdirSync(OUTPUT_DIR, { recursive: true });
		writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2) + '\n');

		expect(existsSync(OUTPUT_FILE)).toBe(true);
		expect(compared).toBeGreaterThan(0);
	});
});
