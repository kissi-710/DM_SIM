import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/cli/args';

describe('CLI の引数の読み取り', () => {
  it('--key value と --flag を読み、値の無い --flag は "true"', () => {
    const { opts, positional } = parseArgs(['--games', '100', '--json', '--seed', '7']);
    expect(opts).toEqual({ games: '100', json: 'true', seed: '7' });
    expect(positional).toEqual([]);
  });
  it('--flag の次が別の --option なら、値にしない', () => {
    expect(parseArgs(['--a', '--b', 'x']).opts).toEqual({ a: 'true', b: 'x' });
  });
  it('-- で始まらない語は positional に集める(値として消費された語は除く)', () => {
    const { opts, positional } = parseArgs(['match', '--a', 'rule', 'extra']);
    expect(opts).toEqual({ a: 'rule' });
    expect(positional).toEqual(['match', 'extra']);
  });
});
