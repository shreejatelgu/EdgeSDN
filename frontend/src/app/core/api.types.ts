export * from './models';

export interface PredictionRecordLike {
  id: number; runId: string; generatedAt: string; linkId: string; horizonMinutes: number;
  predictedUtilization: number; lowerBound: number; upperBound: number; congestionRisk: number;
  confidence: number; source: string; modelVersion: string;
}
