import { describe, expect, it } from 'vitest';
import { keyInput, macKeys } from '@talkthrough/shared';

describe('keyInput', () => {
  it('GIVEN a letter WHEN typed THEN a keyDown carries its text', () => {
    expect(keyInput({ key: 'è', code: 'BracketLeft', keyCode: 186, modifiers: 0 })).toEqual({
      type: 'input_keyboard',
      eventType: 'keyDown',
      key: 'è',
      code: 'BracketLeft',
      windowsVirtualKeyCode: 186,
      modifiers: 0,
      text: 'è'
    });
  });

  it('GIVEN keys that move or delete WHEN pressed THEN a rawKeyDown carries the virtual key code', () => {
    expect(keyInput({ key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, modifiers: 8 })).toEqual({
      type: 'input_keyboard',
      eventType: 'rawKeyDown',
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      windowsVirtualKeyCode: 37,
      modifiers: 8
    });
    // Enter types a return (it submits forms); ⌘ or Ctrl with a letter types nothing
    expect(keyInput({ key: 'Enter', code: 'Enter', keyCode: 13, modifiers: 0 })).toMatchObject({
      eventType: 'keyDown',
      text: '\r'
    });
    expect(keyInput({ key: 'r', code: 'KeyR', keyCode: 82, modifiers: 4 })).not.toHaveProperty(
      'text'
    );
    expect(keyInput({ key: 'a', code: 'KeyA', keyCode: 65, modifiers: 0 }, true)).toMatchObject({
      eventType: 'keyUp',
      windowsVirtualKeyCode: 65
    });
  });
});

describe('macKeys', () => {
  it('GIVEN ⌘ with arrows or Backspace WHEN pressed on macOS THEN they become keys Chrome acts on', () => {
    expect(macKeys({ key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, modifiers: 4 + 8 })).toEqual(
      [{ key: 'Home', code: 'Home', keyCode: 36, modifiers: 8 }]
    );
    expect(macKeys({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, modifiers: 4 })).toEqual([
      { key: 'End', code: 'End', keyCode: 35, modifiers: 0 }
    ]);
    expect(
      macKeys({ key: 'Backspace', code: 'Backspace', keyCode: 8, modifiers: 4 }).map((one) => [
        one.key,
        one.modifiers
      ])
    ).toEqual([
      ['Home', 8],
      ['Backspace', 0]
    ]);
    const option = { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, modifiers: 1 };
    expect(macKeys(option)).toEqual([option]);
  });
});
