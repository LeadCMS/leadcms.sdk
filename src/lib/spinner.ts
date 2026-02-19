/**
 * Lightweight CLI spinner for progress indication.
 * Zero dependencies — uses ANSI escape codes directly.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

export interface Spinner {
    /** Update the message while spinning */
    update(message: string): void;
    /** Stop and clear the spinner line */
    stop(): void;
    /** Stop and replace with a final message */
    succeed(message: string): void;
    /** Stop and replace with an error message */
    fail(message: string): void;
}

/**
 * Start an animated spinner with the given message.
 *
 * ```ts
 * const spin = startSpinner('Fetching data…');
 * await doWork();
 * spin.stop();
 * ```
 */
export function startSpinner(message: string): Spinner {
    let frameIndex = 0;
    let currentMessage = message;
    let stopped = false;

    // Hide cursor
    process.stderr.write('\x1b[?25l');

    const timer = setInterval(() => {
        const frame = FRAMES[frameIndex % FRAMES.length];
        // \r moves to start of line, \x1b[K clears to end of line
        process.stderr.write(`\r\x1b[K\x1b[36m${frame}\x1b[0m ${currentMessage}`);
        frameIndex++;
    }, INTERVAL_MS);

    // Ensure cursor is restored if the process exits unexpectedly
    const cleanup = () => {
        if (!stopped) {
            clearInterval(timer);
            process.stderr.write('\r\x1b[K\x1b[?25h');
            stopped = true;
        }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);

    function clear(): void {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        // Clear the spinner line and restore cursor
        process.stderr.write('\r\x1b[K\x1b[?25h');
        process.removeListener('exit', cleanup);
        process.removeListener('SIGINT', cleanup);
    }

    return {
        update(msg: string) {
            currentMessage = msg;
        },
        stop() {
            clear();
        },
        succeed(msg: string) {
            clear();
            process.stderr.write(`\r\x1b[K\x1b[32m✔\x1b[0m ${msg}\n`);
        },
        fail(msg: string) {
            clear();
            process.stderr.write(`\r\x1b[K\x1b[31m✖\x1b[0m ${msg}\n`);
        },
    };
}
