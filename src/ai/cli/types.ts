export type CliToolCommandResult = {
  exitCode: number;
  stdout: string;
  stderr?: string;
};

export type CliInputReader = (path: string) => Promise<string> | string;

