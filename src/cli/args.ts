// CLI の引数の読み取り: `--key value` と `--flag`(値が無ければ 'true')。`--` で始まらない語は positional に集める。
export function parseArgs(argv: string[]): { opts: Record<string, string>; positional: string[] } {
  const opts: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) opts[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    else positional.push(a);
  }
  return { opts, positional };
}
