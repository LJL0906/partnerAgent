import { HttpException, HttpStatus } from '@nestjs/common';
import {
  ANALYSIS_TYPES,
  type AnalysisType,
} from '@partner-agent/contracts';

export function requestedInputAnalysis(
  payload: Record<string, unknown>,
): AnalysisType[] | undefined {
  const requestAnalysis = payload.request_analysis;
  const hasAnalysisTypes = Object.prototype.hasOwnProperty.call(
    payload,
    'analysis_types',
  );

  if (requestAnalysis !== undefined && typeof requestAnalysis !== 'boolean') {
    throw validationError('request_analysis 必须是布尔值', {
      field: 'request_analysis',
    });
  }

  if (requestAnalysis !== true) {
    if (hasAnalysisTypes) {
      throw validationError(
        '仅 request_analysis=true 时可携带 analysis_types',
        { fields: ['request_analysis', 'analysis_types'] },
      );
    }
    return undefined;
  }

  if (!hasAnalysisTypes) {
    throw validationError('request_analysis=true 时必须提供 analysis_types', {
      field: 'analysis_types',
    });
  }
  const analysisTypes = payload.analysis_types;
  if (!Array.isArray(analysisTypes) || analysisTypes.length === 0) {
    throw validationError('analysis_types 必须是非空数组', {
      field: 'analysis_types',
    });
  }
  for (const value of analysisTypes) {
    if (
      typeof value !== 'string' ||
      !(ANALYSIS_TYPES as readonly string[]).includes(value)
    ) {
      throw validationError('analysis_types 包含不支持的分析类型', {
        field: 'analysis_types',
        allowed_values: ANALYSIS_TYPES,
      });
    }
  }
  if (new Set(analysisTypes).size !== analysisTypes.length) {
    throw validationError('analysis_types 不能包含重复值', {
      field: 'analysis_types',
    });
  }
  return analysisTypes as AnalysisType[];
}

function validationError(
  message: string,
  details: Record<string, unknown>,
) {
  return new HttpException(
    { code: 'VALIDATION_001', message, details },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}
