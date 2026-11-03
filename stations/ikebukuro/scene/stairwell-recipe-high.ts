/** Baked high-tier stairwell recipe (#658); dynamically imported so headless loads never read bundled data. */
import text from "./stairwell-cut.high.b64.txt?raw";

export default "data:application/octet-stream;base64," + text;
