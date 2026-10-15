"""EDGE-SDN twin-agent REST API (FastAPI). Must run as root, single worker:

    sudo -E .venv/bin/uvicorn agent.main:app --host 0.0.0.0 --port 8000 --workers 1
"""
import hmac
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException

from . import config
from .models import LiveProbeRequest, LiveTrafficRequest, TwinRequest
from .network import EmulatedNetwork
from .topology import compute_spec
from .traffic import LiveTraffic, probe_pairs, run_measurement

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("edge.agent")

state = {"spec": None, "live": None, "twin": None, "traffic": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.geteuid() != 0:
        raise RuntimeError("The twin-agent must run as root (Mininet needs network namespaces).")
    from mininet.log import setLogLevel
    setLogLevel("warning")
    if config.CLEAN_ON_START:
        from mininet.clean import cleanup
        cleanup()  # removes leftovers of a previous crashed run
    spec = compute_spec()
    state["spec"] = spec
    if config.START_LIVE:
        live = EmulatedNetwork(spec, "", "h", 0, config.CONTROLLER_IP, config.CONTROLLER_PORT)
        live.start()
        state["live"] = live
        state["traffic"] = LiveTraffic(live)
    if config.START_TWIN:
        twin = EmulatedNetwork(spec, "t", "x", 0x1000, None)
        twin.start()
        state["twin"] = twin
    log.info("twin-agent ready (live=%s, twin=%s, datapath=%s)", config.START_LIVE, config.START_TWIN,
             config.OVS_DATAPATH)
    try:
        yield
    finally:
        if state["traffic"]:
            state["traffic"].stop()
        for key in ("twin", "live"):
            if state[key]:
                try:
                    state[key].stop()
                except Exception as e:  # keep shutting down the other network
                    log.warning("stopping %s failed: %s", key, e)


app = FastAPI(title="EDGE-SDN Twin Agent", version="1.0.0", lifespan=lifespan)


def require_token(x_edge_token: str = Header(default="")):
    if not hmac.compare_digest(x_edge_token.encode(), config.AGENT_TOKEN.encode()):
        raise HTTPException(status_code=401, detail="invalid agent token")


def _live():
    if not state["live"] or not state["live"].running:
        raise HTTPException(status_code=409, detail="live network is not running (EDGE_START_LIVE=0?)")
    return state["live"]


def _twin():
    if not state["twin"] or not state["twin"].running:
        raise HTTPException(status_code=409, detail="digital twin is not running")
    return state["twin"]


@app.get("/health")
def health():
    return {"status": "UP",
            "live": bool(state["live"] and state["live"].running),
            "twin": bool(state["twin"] and state["twin"].running),
            "datapath": config.OVS_DATAPATH,
            "controller": f"{config.CONTROLLER_IP}:{config.CONTROLLER_PORT}"}


@app.get("/topology", dependencies=[Depends(require_token)])
def topology():
    spec = state["spec"]
    return {k: spec[k] for k in ("switches", "hosts", "links", "groups")}


@app.get("/live/port-stats", dependencies=[Depends(require_token)])
def live_port_stats():
    return {"timestamp": time.time(), "switches": _live().port_counters()}


@app.post("/live/probe", dependencies=[Depends(require_token)])
def live_probe(req: LiveProbeRequest):
    live = _live()
    try:
        return {"probes": probe_pairs(live, req.pairs, req.count)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/live/traffic/start", dependencies=[Depends(require_token)])
def live_traffic_start(req: LiveTrafficRequest):
    _live()
    try:
        return state["traffic"].start(req.traffic, req.durationSec)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/live/traffic/stop", dependencies=[Depends(require_token)])
def live_traffic_stop():
    _live()
    return state["traffic"].stop()


@app.get("/live/traffic", dependencies=[Depends(require_token)])
def live_traffic_status():
    _live()
    return state["traffic"].status()


@app.post("/twin/simulate", dependencies=[Depends(require_token)])
def twin_simulate(req: TwinRequest):
    """Load the complete rule set into the twin, replay the traffic profile and return measured KPIs."""
    twin = _twin()
    with twin.lock:  # one simulation at a time
        try:
            twin.load_rules(req.flows, req.meters)
            return run_measurement(twin, req.traffic, req.probes, req.durationSec, config.TWIN_PORT_BASE)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=str(e))


@app.post("/twin/rebuild", dependencies=[Depends(require_token)])
def twin_rebuild():
    twin = _twin()
    with twin.lock:
        twin.stop()
        twin.start()
    return {"status": "rebuilt"}
