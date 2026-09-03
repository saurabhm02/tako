/**
 * Centralized secret and credential scrubbing for runtime errors, logs, activity timeline, and persisted execution state.
 */

const SECRET_PATTERNS = [
  // OpenAI API keys
  /(?:sk-[a-zA-Z0-9_-]{20,})/g,
  // Bearer tokens
  /(?:Bearer\s+[a-zA-Z0-9._-]{20,})/gi,
  // Google API keys
  /(?:AIza[0-9A-Za-z-_]{35})/g,
  // GitHub Personal Access Tokens
  /(?:ghp_[a-zA-Z0-9]{36})/g,
  // AWS Access Key IDs
  /(?:AKIA[0-9A-Z]{16})/g,
];

/**
 * Sanitizes any text string by masking API keys, bearer tokens, and secrets.
 *
 * @param text - The raw message or log string.
 * @returns Sanitized string safe for UI display and logging.
 */
export function sanitizeSecretText(text: string): string {
  if (!text) return "";
  let result = text;
  result = result.replace(/(?:sk-[a-zA-Z0-9_-]{20,})/g, "sk-***");
  result = result.replace(/(?:Bearer\s+[a-zA-Z0-9._-]{20,})/gi, "Bearer ***");
  result = result.replace(/(?:AIza[0-9A-Za-z-_]{35})/g, "AIza***");
  result = result.replace(/(?:ghp_[a-zA-Z0-9]{36})/g, "ghp_***");
  result = result.replace(/(?:AKIA[0-9A-Z]{16})/g, "AKIA***");
  return result;
}
