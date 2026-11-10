/**
 * One axios instance for the whole dashboard (defined in src/lib/api.js so the
 * classic screens and the new console share the token + 401 handling).
 */
export { default } from "../../lib/api";
