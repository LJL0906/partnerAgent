import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { requestedInputAnalysis } from './input-analysis.validator.js';

describe('requestedInputAnalysis', () => {
  it.each([{}, { request_analysis: false }])(
    'keeps ordinary chat unchanged for %j',
    (payload) => {
      expect(requestedInputAnalysis(payload)).toBeUndefined();
    },
  );

  it.each([
    { analysis_types: ['idea_organize'] },
    { request_analysis: false, analysis_types: ['idea_organize'] },
  ])('rejects analysis_types unless analysis is requested', (payload) => {
    expectValidationError(payload);
  });

  it.each([
    { request_analysis: true, analysis_types: [] },
    { request_analysis: true },
    { request_analysis: true, analysis_types: ['unknown'] },
    {
      request_analysis: true,
      analysis_types: ['idea_organize', 'idea_organize'],
    },
    { request_analysis: 'true' },
  ])('rejects invalid analysis parameters: %j', (payload) => {
    expectValidationError(payload);
  });

  it('returns allowed unique analysis types', () => {
    expect(
      requestedInputAnalysis({
        request_analysis: true,
        analysis_types: ['idea_organize', 'content_extract'],
      }),
    ).toEqual(['idea_organize', 'content_extract']);
  });
});

function expectValidationError(payload: Record<string, unknown>) {
  try {
    requestedInputAnalysis(payload);
    throw new Error('expected validation error');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(422);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'VALIDATION_001',
    });
  }
}
