/**
 * Count the calling component in the dev mount gauge for its mounted lifetime.
 * Rows and list items aren't BlockHosts, so without this a windowed giant
 * container would read as ~0 mounted blocks. Gated on `perfEnabled()`, which
 * only arms under dev/Vitest, so production pays one boolean per mount/unmount.
 */
import { perfEnabled, incMountedBlocks, decMountedBlocks } from './instruments';

export function useMountGauge(): void {
	$effect(() => {
		// One decision per mount: the gauge is a net balance, so re-reading the flag
		// at teardown lets an arm/disarm flip between the two decrement a mount that
		// was never counted (or strand one that was).
		if (!perfEnabled()) return;
		incMountedBlocks();
		return decMountedBlocks;
	});
}
