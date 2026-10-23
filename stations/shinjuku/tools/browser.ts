/** Browser used by the QA tools: Brave by default (never Chrome); GTEKI_BROWSER overrides the executable. */
export const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
export const browserTarget = () => ({ executablePath: process.env.GTEKI_BROWSER || BRAVE });
