// A letter typed in a 60-line code fence, the row the perf a/b probe runs on both builds: the
// highlight package paints on the lane, the core's own languages on a build without it.
import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { measureCodeFenceTyping, percentileMs, writePerfResult } from './latency-harness';

const FENCE_LINES = 60;
const TYPED_KEYS = 60;

test('perf a/b: a letter typed at the end of a 60-line code fence', async ({ page }) => {
	const m = await measureCodeFenceTyping(page, new EditorPage(page), FENCE_LINES, TYPED_KEYS);
	writePerfResult('PERF-AB', 'ab-type-code-fence', {
		gesture: 'type-code-fence',
		label: 'a letter typed at the end of a 60-line code fence',
		blockDelta: 0,
		samples: m.samples,
		p50Ms: percentileMs(m.samples, 50),
		p95Ms: percentileMs(m.samples, 95)
	});
});
