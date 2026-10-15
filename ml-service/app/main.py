"""EDGE-SDN ML service (contract skeleton). Run:  uvicorn app.main:app --host 0.0.0.0 --port 8001"""
import os

from fastapi import Depends, FastAPI, Header, HTTPException

from .model import MODEL
from .schemas import CounterfactualRequest, ExplainRequest, PredictionInput, PredictResponse
import logging
import time

log = logging.getLogger("uvicorn.error")

API_KEY = os.environ.get("EDGE_ML_API_KEY", "")

app = FastAPI(title="EDGE-SDN ML Service", version="0.1.0")


def require_key(x_api_key: str = Header(default="")):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid API key")


@app.get("/api/v1/health")
def health():
    return {"status": "UP", "modelVersion": MODEL.version}


@app.get("/api/v1/model-info", dependencies=[Depends(require_key)])
def model_info():
    return {"modelVersion": MODEL.version, "type": type(MODEL).__name__,
            "isTrainedModel": not MODEL.version.startswith("placeholder"),
            "horizonsSupported": [15, 30, 60], "explainMethods": ["NONE"] if MODEL.version.startswith("placeholder") else ["SHAP"]}





@app.post("/api/v1/predict", response_model=PredictResponse, dependencies=[Depends(require_key)])
def predict(inp: PredictionInput):
    t0 = time.time()
    preds = MODEL.predict(inp)
    log.info("predict: %d links, %d events, %d history points -> %.2fs", len(inp.links), len(inp.events),
             sum(len(l.history) for l in inp.links), time.time() - t0)
    return PredictResponse(modelVersion=MODEL.version, predictions=preds)


@app.post("/api/v1/explain", dependencies=[Depends(require_key)])
def explain(req: ExplainRequest):
    if MODEL.version.startswith("placeholder"):
        return {"linkId": req.linkId, "horizonMinutes": req.horizonMinutes, "explanation": None}
    return {"linkId": req.linkId, "horizonMinutes": req.horizonMinutes,
            "explanation": MODEL.explain(req.input, req.linkId, req.horizonMinutes, req.method).model_dump()}


@app.post("/api/v1/counterfactual", dependencies=[Depends(require_key)])
def counterfactual(req: CounterfactualRequest):
    cfs = MODEL.counterfactual(req.input, req.linkId, req.horizonMinutes, req.targetUtilization, req.maxChanges)
    return {"linkId": req.linkId, "horizonMinutes": req.horizonMinutes,
            "counterfactuals": [c.model_dump() for c in cfs]}
