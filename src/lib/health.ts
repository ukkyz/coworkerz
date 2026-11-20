/**
 * Readiness helpers for the single anonymous endpoint.
 * Re-exported here so the health route reads as one intent instead of a grab bag.
 */
export {
  authMode,
  MIN_SECRET_LENGTH,
  SESSION_SECRET_ENV,
} from "./session";

export { CEO_ACCESS_CODE_ENV } from "./sign-in";
