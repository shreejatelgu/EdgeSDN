import cProfile
import pstats
import time
from datetime import datetime, timedelta, timezone

from app.model import MODEL
from app.schemas import EventInfo, LinkHistory, PredictionInput, UtilPoint

now = datetime.now(timezone.utc).replace(microsecond=0)
ids = ["c1-c2", "c1-d1", "c1-d2", "c1-d3", "c1-d4", "a1-d1", "a2-d1", "a3-d2", "a4-d2", "a5-d3", "a6-d4",
       "c2-d1", "c2-d2", "c2-d3", "c2-d4"]
groups = ["ADMIN", "EXAM_HALL", "HOSTEL", "LAB", "LIBRARY"]
links = [LinkHistory(linkId=i, capacityMbps=20, groups=groups,
                     history=[UtilPoint(ts=now - timedelta(seconds=10 * (359 - k)), utilization=0.3)
                              for k in range(360)]) for i in ids]
events = [EventInfo(name=f"e{n}", type=t, startTime=now + timedelta(minutes=5 * n), durationMinutes=120,
                    expectedIntensity=0.7, affectedGroups=groups[:3])
          for n, t in enumerate(["EXAM", "PLACEMENT", "FESTIVAL", "OTHER"])]
inp = PredictionInput(generatedAt=now, horizonsMinutes=[15, 30, 60], congestionThreshold=0.8,
                      links=links, events=events)

print(type(MODEL).__name__, MODEL.version)
MODEL.predict(inp)                                   # warm-up
t = time.time(); MODEL.predict(inp)
print(f"\npredict (15 links, 360 pts each, 4 active events): {time.time() - t:.2f}s\n")
pr = cProfile.Profile(); pr.enable(); MODEL.predict(inp); pr.disable()
pstats.Stats(pr).sort_stats("cumulative").print_stats(10)