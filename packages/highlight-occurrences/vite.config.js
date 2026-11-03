// The package's prebuilt build, shared by every bundled plugin.
import { pluginPrebuiltConfig } from '../../scripts/pack/plugin-prebuilt.mjs';

export default pluginPrebuiltConfig(import.meta.dirname);
