/**
 * Centralized logger for LeadCMS SDK CLI.
 *
 * Controls output verbosity:
 * - verbose messages (debug/internal) are only shown when --verbose is passed
 * - info/progress messages are always shown (user-facing progress indicators)
 * - success/warn/error messages are always shown
 *
 * Usage:
 *   import { logger } from '../lib/logger.js';
 *   logger.setVerbose(true);        // enable verbose output
 *   logger.verbose('[API] ....');   // only shown with --verbose
 *   logger.info('Fetching...');     // always shown
 *   logger.success('Done!');        // always shown
 */

import { colorConsole } from './console-colors.js';
import { registerApiLogger } from './api-logger.js';

let _verbose = false;

/**
 * Enable or disable verbose logging.
 * Call this once at CLI entry based on --verbose flag.
 */
export function setVerbose(value: boolean): void {
  _verbose = value;
}

/**
 * Check whether verbose mode is active.
 */
export function isVerbose(): boolean {
  return _verbose;
}

export const logger = {
  /** Set verbose mode */
  setVerbose,

  /** Check verbose mode */
  isVerbose,

  /**
   * Verbose/debug output — only printed when --verbose is active.
   * Use for internal details: API URLs, sync tokens, file counts, debug info.
   */
  verbose: (message: string, ...args: any[]): void => {
    if (_verbose) {
      colorConsole.debug(message, ...args);
    }
  },

  /**
   * Info / progress — always printed.
   * Use for user-facing progress: "Fetching content...", "Scanning files..."
   */
  info: (message: string, ...args: any[]): void => {
    colorConsole.info(message, ...args);
  },

  /**
   * Success — always printed.
   */
  success: (message: string, ...args: any[]): void => {
    colorConsole.success(message, ...args);
  },

  /**
   * Warning — always printed.
   */
  warn: (message: string, ...args: any[]): void => {
    colorConsole.warn(message, ...args);
  },

  /**
   * Error — always printed.
   */
  error: (message: string, ...args: any[]): void => {
    colorConsole.error(message, ...args);
  },

  /**
   * Plain log — always printed. For structured output (status tables, etc.)
   */
  log: (message: any, ...args: any[]): void => {
    console.log(message, ...args);
  },
};

/**
 * Parse --verbose flag from process.argv and activate verbose mode.
 * Also checks LEADCMS_VERBOSE env var.
 * Call this at the top of each CLI entry point.
 */
export function initVerboseFromArgs(args: string[] = process.argv): void {
  if (args.includes('--verbose') || args.includes('-V') || process.env.LEADCMS_VERBOSE === 'true') {
    setVerbose(true);
    registerApiLogger();
  }
}
