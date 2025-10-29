/**
 * Console color utilities for better user experience
 * Uses ANSI escape codes for terminal colors
 */

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
} as const;

/**
 * Check if colors should be disabled (for CI/non-TTY environments)
 */
function shouldUseColors(): boolean {
  // Check if NO_COLOR env var is set
  if (process.env.NO_COLOR) {
    return false;
  }

  // Check if we're in a TTY (terminal)
  if (typeof process.stdout.isTTY === 'boolean') {
    return process.stdout.isTTY;
  }

  // Default to true for most environments
  return true;
}

/**
 * Apply color to text if colors are enabled
 */
function colorize(text: string, color: string): string {
  return shouldUseColors() ? `${color}${text}${colors.reset}` : text;
}

/**
 * Colored console logging utilities
 */
export const colorConsole = {
  // Success messages (green)
  success: (message: any, ...args: any[]) => {
    console.log(colorize(String(message), colors.green), ...args);
  },

  // Error messages (red)
  error: (message: any, ...args: any[]) => {
    console.error(colorize(String(message), colors.red), ...args);
  },

  // Warning messages (yellow)
  warn: (message: any, ...args: any[]) => {
    console.warn(colorize(String(message), colors.yellow), ...args);
  },

  // Info messages (cyan)
  info: (message: any, ...args: any[]) => {
    console.log(colorize(String(message), colors.cyan), ...args);
  },

  // Debug messages (gray)
  debug: (message: any, ...args: any[]) => {
    console.log(colorize(String(message), colors.gray), ...args);
  },

  // Progress messages (blue)
  progress: (message: any, ...args: any[]) => {
    console.log(colorize(String(message), colors.blue), ...args);
  },

  // Important messages (bright/bold)
  important: (message: any, ...args: any[]) => {
    console.log(colorize(String(message), colors.bright), ...args);
  },

  // Highlight text within a message
  highlight: (text: string) => colorize(text, colors.bright + colors.cyan),

  // Color specific parts of messages
  red: (text: string) => colorize(text, colors.red),
  green: (text: string) => colorize(text, colors.green),
  yellow: (text: string) => colorize(text, colors.yellow),
  blue: (text: string) => colorize(text, colors.blue),
  cyan: (text: string) => colorize(text, colors.cyan),
  gray: (text: string) => colorize(text, colors.gray),
  bold: (text: string) => colorize(text, colors.bright),

  // Regular console.log but respects color settings
  log: (message: any, ...args: any[]) => {
    console.log(message, ...args);
  }
};

/**
 * Create colored diff output for better readability
 */
export const diffColors = {
  added: (text: string) => colorize(text, colors.green),
  removed: (text: string) => colorize(text, colors.red),
  modified: (text: string) => colorize(text, colors.yellow),
  unchanged: (text: string) => text, // No color for unchanged
  header: (text: string) => colorize(text, colors.bright + colors.cyan),
  lineNumber: (text: string) => colorize(text, colors.gray),
};

/**
 * Status-specific colors for different operation types
 */
export const statusColors = {
  created: (text: string) => colorize(text, colors.green),
  modified: (text: string) => colorize(text, colors.yellow),
  renamed: (text: string) => colorize(text, colors.blue),
  conflict: (text: string) => colorize(text, colors.red),
  synced: (text: string) => colorize(text, colors.green),
  typeChange: (text: string) => colorize(text, colors.magenta),
};

// Export individual color functions for convenience
export const { success, error, warn, info, debug, progress, important, log } = colorConsole;
