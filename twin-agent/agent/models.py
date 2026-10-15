"""Request/response models (must match com.edgesdn.agent.AgentModels and com.edgesdn.routing.*)."""
import ipaddress
import re
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

_NAME = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


def _cidr(v: Optional[str]) -> Optional[str]:
    if v is None:
        return v
    ipaddress.ip_network(v, strict=False)  # raises ValueError on garbage
    return v


class FlowMatch(BaseModel):
    ethType: Optional[int] = None
    ipv4Src: Optional[str] = None
    ipv4Dst: Optional[str] = None
    inPort: Optional[int] = Field(default=None, ge=1, le=65279)

    @field_validator("ipv4Src", "ipv4Dst")
    @classmethod
    def _check_cidr(cls, v: Optional[str]) -> Optional[str]:
        return _cidr(v)


class FlowSpec(BaseModel):
    id: str
    switchName: str
    table: int = Field(default=0, ge=0, le=254)
    priority: int = Field(default=100, ge=0, le=65535)
    match: FlowMatch = FlowMatch()
    outputPort: Optional[int] = Field(default=None, ge=1, le=65279)
    gotoTable: Optional[int] = Field(default=None, ge=0, le=254)
    meterId: Optional[int] = Field(default=None, ge=1, le=4294901760)

    @field_validator("id", "switchName")
    @classmethod
    def _safe(cls, v: str) -> str:
        if not _NAME.match(v):
            raise ValueError("invalid identifier")
        return v


class MeterSpec(BaseModel):
    switchName: str
    meterId: int = Field(ge=1, le=4294901760)
    rateKbps: int = Field(ge=1)
    burstKb: int = Field(default=0, ge=0)


class TrafficFlow(BaseModel):
    tag: str = ""
    src: str
    dst: str
    rateMbps: float = Field(gt=0, le=1000)


class ProbePair(BaseModel):
    tag: str = ""
    src: str
    dst: str


class TwinRequest(BaseModel):
    flows: List[FlowSpec]
    meters: List[MeterSpec] = []
    traffic: List[TrafficFlow] = []
    probes: List[ProbePair] = []
    durationSec: int = Field(default=8, ge=3, le=30)


class LiveProbeRequest(BaseModel):
    pairs: List[ProbePair]
    count: int = Field(default=5, ge=1, le=50)


class LiveTrafficRequest(BaseModel):
    traffic: List[TrafficFlow]
    durationSec: int = Field(default=600, ge=5, le=3600)
