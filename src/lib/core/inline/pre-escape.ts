/**
 * Stage 0 of the inline pipeline: normalize CommonMark backslash escapes so
 * downstream stages (backtick scan, link/image/autolink scan, delimiter run
 * scan) see `\<punct>` as literal text rather than as active syntax.
 *
 * Status (0.5.5.4): identity pass — no behavior change. The stage boundary
 * exists so 0.6.2 can fill in the CommonMark 6.1 escape rule without
 * touching call sites.
 *
 * When 0.6.2 lands, this stage will produce a normalized raw slice (or an
 * occupied-range map keyed to the original raw) that later stages consume.
 * The exact shape is deferred to 0.6.2's design.
 */

export interface PreEscapeResult {
	/** True when the stage modified the input. 0.5.5.4: always false. */
	modified: boolean;
}

/**
 * Identity pass at 0.5.5.4. Returns a marker indicating no modification.
 * The stage boundary exists so future fills can change scanner inputs
 * without changing the pipeline shape in index.ts.
 */
export function preEscapeInline(_raw: string, _start: number, _end: number): PreEscapeResult {
	return { modified: false };
}
