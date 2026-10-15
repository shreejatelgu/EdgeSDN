"""ML service wire contract. Must match com.edgesdn.prediction.PredictionModels and com.edgesdn.ml.MlModels."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class UtilPoint(BaseModel):
    ts: datetime
    utilization: float


class LinkHistory(BaseModel):
    linkId: str
    capacityMbps: float
    groups: List[str] = []
    history: List[UtilPoint] = []


class EventInfo(BaseModel):
    id: Optional[int] = None
    name: str
    type: str  # EXAM | PLACEMENT | FESTIVAL | OTHER
    startTime: datetime
    durationMinutes: int
    expectedIntensity: float = Field(ge=0, le=1)
    affectedGroups: List[str] = []


class PredictionInput(BaseModel):
    generatedAt: datetime
    horizonsMinutes: List[int]
    congestionThreshold: float
    links: List[LinkHistory]
    events: List[EventInfo] = []


class Factor(BaseModel):
    name: str
    value: float
    contribution: float  # in utilisation units: 0.10 = +10 percentage points
    description: str


class Counterfactual(BaseModel):
    description: str
    predictedUtilization: float


class Explanation(BaseModel):
    method: str  # SHAP | LIME | NONE
    factors: List[Factor] = []
    summary: str = ""


class Forecast(BaseModel):
    linkId: str
    horizonMinutes: int
    predictedUtilization: float
    lower: Optional[float] = None
    upper: Optional[float] = None
    congestionRisk: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    explanation: Optional[Explanation] = None
    counterfactuals: List[Counterfactual] = []


class PredictResponse(BaseModel):
    modelVersion: str
    predictions: List[Forecast]


class ExplainRequest(BaseModel):
    input: PredictionInput
    linkId: str
    horizonMinutes: int
    method: str = "SHAP"


class CounterfactualRequest(BaseModel):
    input: PredictionInput
    linkId: str
    horizonMinutes: int
    targetUtilization: float
    maxChanges: int = 2
