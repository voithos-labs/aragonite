// svelte-package copies all of src/lib into dist, tests included; strip them before pack.
// The verify-pack negative gate catches any straggler this misses.
import { rmSync } from 'node:fs';

for (const dir of ['dist/test', 'dist/e2e']) {
	rmSync(dir, { recursive: true, force: true });
}
