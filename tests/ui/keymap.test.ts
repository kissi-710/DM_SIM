// ショートカットキーの正規化(IME・配列・修飾)と、キー割り当ての重なり
import { describe, expect, it } from 'vitest';
import { digitOf, KEY, keyLabel, keyToken, SHORTCUTS, SLOT_KEYS } from '../../src/ui/keymap';

describe('keyToken', () => {
  it('文字は小文字、数字・名前付きキーはそのまま返す', () => {
    expect(keyToken({ key: 'E' })).toBe('e');
    expect(keyToken({ key: 'e' })).toBe('e');
    expect(keyToken({ key: '3' })).toBe('3');
    expect(keyToken({ key: 'Enter' })).toBe('Enter');
    expect(keyToken({ key: 'Escape' })).toBe('Escape');
    expect(keyToken({ key: ' ' })).toBe(' ');
    expect(keyToken({ key: 'ArrowUp' })).toBe('ArrowUp');
    expect(keyToken({ key: '?' })).toBe('?');
    expect(keyToken({ key: '/', shiftKey: true })).toBe('?');
  });
  it('対応外のキーは null', () => {
    expect(keyToken({ key: 'F5' })).toBeNull();
    expect(keyToken({ key: 'Tab' })).toBeNull();
    expect(keyToken({ key: '/' })).toBeNull();
  });
  it('IME が ON(key が Process)でも、物理キー(code)から決める', () => {
    expect(keyToken({ key: 'Process', code: 'KeyM', keyCode: 229 })).toBe('m');
    expect(keyToken({ key: 'Process', code: 'Digit2', keyCode: 229 })).toBe('2');
    expect(keyToken({ key: 'Process', code: 'Numpad7', keyCode: 229 })).toBe('7');
    expect(keyToken({ key: 'Process', code: 'Enter', keyCode: 229 })).toBe('Enter');
    expect(keyToken({ key: 'Process', code: 'Space', keyCode: 229 })).toBe(' ');
    expect(keyToken({ key: 'Process', code: 'Slash', shiftKey: true, keyCode: 229 })).toBe('?');
    expect(keyToken({ key: 'a', code: 'KeyA', isComposing: true })).toBe('a');
  });
  it('配列が違っても、key が文字ならその文字を使う(Dvorak などで code に引きずられない)', () => {
    expect(keyToken({ key: 'e', code: 'KeyD' })).toBe('e');
  });
});

describe('digitOf / keyLabel', () => {
  it('数字キーは 0〜8、それ以外は -1', () => {
    expect(digitOf('1')).toBe(0);
    expect(digitOf('9')).toBe(8);
    expect(digitOf('0')).toBe(-1);
    expect(digitOf('a')).toBe(-1);
    expect(digitOf(null)).toBe(-1);
  });
  it('表記', () => {
    expect(keyLabel('e')).toBe('E');
    expect(keyLabel(' ')).toBe('Space');
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('Enter')).toBe('Enter');
  });
});

describe('キーの割り当て', () => {
  it('文字キーの割り当てが、別の操作と重ならない(同じキーを2つの意味にしない)', () => {
    const byKey = new Map<string, string[]>();
    for (const [name, k] of Object.entries(KEY)) byKey.set(k, [...(byKey.get(k) ?? []), name]);
    const dup = [...byKey.entries()].filter(([, names]) => names.length > 1);
    expect(dup).toEqual([]);
  });
  it('割り振りの枠のキーは、入力パネルの他のキーと重ならない', () => {
    const panel: string[] = [KEY.yes, KEY.no, KEY.auto, KEY.redo];
    for (const k of SLOT_KEYS) expect(panel).not.toContain(k);
  });
  it('ヘルプの表は、場面・キー・内容がすべて埋まっている', () => {
    for (const [scene, key, what] of SHORTCUTS) {
      expect(scene).not.toBe('');
      expect(key).not.toBe('');
      expect(what).not.toBe('');
    }
  });
});
