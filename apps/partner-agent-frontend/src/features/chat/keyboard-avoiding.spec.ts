import { describe, expect, it } from 'vitest';

import { getKeyboardAvoidingProps } from './keyboard-avoiding';

describe('getKeyboardAvoidingProps', () => {
  it('uses padding on iOS and height on Android', () => {
    expect(getKeyboardAvoidingProps('ios', 24)).toEqual({ enabled: true, behavior: 'padding', keyboardVerticalOffset: 24 });
    expect(getKeyboardAvoidingProps('android', 24)).toEqual({ enabled: true, behavior: 'height', keyboardVerticalOffset: 0 });
  });
});
