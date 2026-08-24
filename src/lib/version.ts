/**
 * The single source of truth for the version the application displays.
 *
 * It used to be written into the footer twice (app shell + login) and again
 * into each of the four translated footer strings, so a release meant editing
 * six places and any one of them could be missed. The translations now carry
 * only the wording; the version is appended from here.
 *
 * Keep in step with `version` in package.json and the release tag.
 */
export const APP_VERSION = "v1.8.1";
