export interface Output {
  info(message: string): void;
  error(message: string): void;
}

/**
 * The console-backed output used by the CLI.
 *
 * @returns An Output that writes to stdout and stderr.
 */
export function consoleOutput(): Output {
  return {
    info: (message) => console.log(message),
    error: (message) => console.error(message),
  };
}
