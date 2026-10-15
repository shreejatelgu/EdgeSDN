from datetime import datetime, timedelta, timezone
from app.model import MODEL
from app.schemas import EventInfo, LinkHistory, PredictionInput, UtilPoint

now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
hist = [UtilPoint(ts=now - timedelta(minutes=59 - i), utilization=0.5 + 0.003 * i) for i in range(60)]
inp = PredictionInput(
    generatedAt=now, horizonsMinutes=[15, 30, 60], congestionThreshold=0.8,
    links=[LinkHistory(linkId="a4-d2", capacityMbps=20, groups=["HOSTEL"], history=hist)],
    events=[EventInfo(name="Fest", type="FESTIVAL", startTime=now + timedelta(minutes=10),
                      durationMinutes=240, expectedIntensity=0.8, affectedGroups=["HOSTEL"])])
print(type(MODEL).__name__, MODEL.version)
for f in MODEL.predict(inp):
    print(f.horizonMinutes, round(f.predictedUtilization, 3), round(f.lower, 3), round(f.upper, 3),
          round(f.congestionRisk, 3), "|", f.explanation.summary)
print(MODEL.counterfactual(inp, "a4-d2", 30, 0.5, 2))