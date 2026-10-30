/**
 * The baked high-tier stairwell cut recipe (#650) as a data URL. This is a `?raw` import of a declared data file
 * (station.json dataFiles): the base64 text is bundled with the code that reads it, not published as an asset.
 * Imported only dynamically, one tier at a time, so headless loads never see it.
 */
import text from "./stairwell-cut.high.b64.txt?raw";

export default "data:application/octet-stream;base64," + text;
