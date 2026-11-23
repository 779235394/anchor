import { describe, expect, it } from 'vitest';
import { shouldShowUpdatePrompt } from '@/services/updater';
import {
  getProjectColorMeta,
  pickNextProjectColor,
  PROJECT_COLOR_PALETTE,
  resolveProjectColor,
} from '../projectColor';

describe('update prompt decision & project colors', () => {
  it('shows update prompt only for unskipped and unsnoozed newer versions', () => {
    expect(
      shouldShowUpdatePrompt({
        available: false,
        version: '0.8.0',
      }),
    ).toBe(false);

    expect(
      shouldShowUpdatePrompt({
        available: true,
        version: 'v0.8.0',
        ignoredVersion: '',
        snoozedVersion: null,
      }),
    ).toBe(true);

    expect(
      shouldShowUpdatePrompt({
        available: true,
        version: '0.8.0',
        ignoredVersion: '0.8.0',
        snoozedVersion: null,
      }),
    ).toBe(false);

    expect(
      shouldShowUpdatePrompt({
        available: true,
        version: '0.8.0',
        ignoredVersion: '',
        snoozedVersion: 'v0.8.0',
      }),
    ).toBe(false);

    // Newer version than previously ignored one must prompt again
    expect(
      shouldShowUpdatePrompt({
        available: true,
        version: '0.9.0',
        ignoredVersion: '0.8.0',
        snoozedVersion: '0.8.0',
      }),
    ).toBe(true);
  });

  it('resolves deterministic project colors and cycles palette cleanly', () => {
    expect(resolveProjectColor('teal', 'p1')).toBe('teal');
    expect(resolveProjectColor('invalid', 'p1')).toBe(resolveProjectColor(undefined, 'p1'));
    expect(getProjectColorMeta({ id: 'p1', color: 'orange' }).dot).toBe('#FF9500');
    expect(pickNextProjectColor(0)).toBe(PROJECT_COLOR_PALETTE[0].key);
    expect(pickNextProjectColor(PROJECT_COLOR_PALETTE.length)).toBe(PROJECT_COLOR_PALETTE[0].key);
  });
});
