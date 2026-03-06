export function parseMultiValueFlag(args: string[], flag: string): string[] | undefined {
  const values: string[] = [];

  args.forEach((arg, index) => {
    if (arg === flag && args[index + 1]) {
      values.push(...args[index + 1].split(',').map(value => value.trim()).filter(Boolean));
    } else if (arg.startsWith(`${flag}=`)) {
      values.push(...arg.slice(flag.length + 1).split(',').map(value => value.trim()).filter(Boolean));
    }
  });

  return values.length > 0 ? values : undefined;
}

export function parseContentStatusFilter(args: string[]): string[] | undefined {
  return parseMultiValueFlag(args, '--status');
}

export function parsePushContentStatusArgs(args: string[]): {
  statusOnly: boolean;
  statusFilter?: string[];
} {
  const statusFilter = parseContentStatusFilter(args);

  const statusOnly = args.some((arg, index) => {
    if (arg !== '--status') {
      return false;
    }

    const nextArg = args[index + 1];
    return !nextArg || nextArg.startsWith('-');
  });

  return { statusOnly, statusFilter };
}
