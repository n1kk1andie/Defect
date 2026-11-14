// The app footer, the same two lines across the Pulsus Intelligence Suite: the
// product and the suite, then the studio and the company. Plain strings, so the
// licence wall (served by the proxy) and the React footer read the same words.
export const APP_NAME = "Pulsus Quality";
export const FOOTER_SUITE = "Part of the Pulsus Intelligence Suite";
export const FOOTER_STUDIO = "A product of Tumblehill Labs, a product studio of Tumblehill Holdings LLC.";

/** The two footer lines, exactly. */
export const footerLines = (): [string, string] => [`${APP_NAME} · ${FOOTER_SUITE}`, FOOTER_STUDIO];
