# EDGE-SDN — Setup, Configuration and Run Guide

EDGE-SDN is an event-aware, digital-twin-gated, explainable architecture for autonomous SDN management. This file is the single reference for installing, configuring and running the project. Follow the steps in order.

> **Status of this code.**
> - **Frontend:** installed, compiled (no errors or warnings) and served on Windows with Node 24.11 and Angular 21.2.
> - **Backend:** compiled with JDK 23.0.1 and Maven 3.9, and started with the H2 profile. It serves its REST API; the twin-agent was unreachable, as expected on Windows.
> - **Twin-agent and ML service:** not run yet (they need the Ubuntu VM and Python packages respectively).
> - **Playwright suites** (section 16): written but not yet executed. The ML model is **not** implemented. The prediction layer runs on a transparent rule-based provider. The ML service is a contract skeleton with a placeholder, with every endpoint already defined and wired into the backend (section 14).

---

## 0. What you are building

```
 Windows 10/11 host                                   Ubuntu 22.04 VM (VirtualBox)
 ┌───────────────────────────────┐   HTTP (host-only  ┌─────────────────────────────────────────┐
 │ Angular 21 UI  :4200           │   192.168.56.x)    │ OpenDaylight (RESTCONF :8181, OF :6653)  │
 │   └─ proxy /api ─► Spring Boot │ ─────────────────► │   ▲ OpenFlow 1.3                         │
 │ Spring Boot 3 backend :8080    │                    │   │                                      │
 │   ingestion · prediction ·     │ ─────────────────► │ twin-agent (FastAPI :8000, root)         │
 │   recommendation · approval ·  │                    │   ├─ LIVE Mininet campus network ────────┘
 │   enforcement · monitor · audit│                    │   └─ DIGITAL TWIN Mininet copy (no ctrl)  │
 │ PostgreSQL :5432               │                    │                                          │
 │ (optional) ML service :8001    │                    │                                          │
 └───────────────────────────────┘                    └─────────────────────────────────────────┘
```

Pipeline implemented in the code:

```
telemetry + institutional events → forecast (15/30/60 min) + factual/counterfactual explanation
 → congestion detected → candidate actions (REROUTE / RATE_LIMIT)
 → every candidate simulated in the Mininet digital twin (plus a no-action baseline)
 → transparent weighted score → recommended + rejected alternative + "why / why not" + decision counterfactual
 → human-impact statement → administrator approves / rejects (or AUTO_LOW_RISK policy approves)
 → rules pushed through OpenDaylight → live monitoring → automatic rollback on KPI regression
 → every step written to a hash-chained audit log
```

### Repository layout

```
edge-sdn/
├── SETUP_GUIDE.md                  ← this file
├── backend/                        Spring Boot 3.2 (Java 17, Maven)
│   ├── pom.xml
│   └── src/main/
│       ├── resources/application.yml, application-h2.yml
│       └── java/com/edgesdn/
│           ├── config/             properties, REST clients, security
│           ├── common/             errors, JSON, maths helpers
│           ├── topology/           topology model + deterministic BFS paths
│           ├── routing/            OpenFlow rule builder (baseline, reroute, rate-limit)
│           ├── agent/              client for the twin-agent
│           ├── sdn/                SdnControllerClient + OpenDaylight implementation
│           ├── telemetry/          Layer 1: port-counter polling → utilisation samples
│           ├── event/              Layer 1: institutional events (CRUD + CSV import)
│           ├── prediction/         Layer 2: provider interface, rule-based provider, scenarios
│           ├── ml/                 Layer 2: ML-service client/provider + ML endpoints
│           ├── twin/               digital-twin gate: traffic profile, KPI calculation
│           ├── recommendation/     candidates, scoring, explanations, impact, pipeline, approval
│           ├── enforcement/        apply via controller, monitoring, rollback
│           ├── network/            baseline initialisation
│           ├── policy/             administrator-tunable policy (DB)
│           ├── audit/              hash-chained audit log
│           └── system/             dashboard, health, seed data
├── twin-agent/                     Python 3.10 + Mininet + FastAPI (runs in the VM as root)
│   ├── agent/{main,network,traffic,ovs,topology,models,config}.py
│   ├── requirements.txt, agent.env.example, run_agent.sh
├── ml-service/                     FastAPI contract skeleton for the future LSTM + SHAP/LIME
│   ├── app/{main,schemas,model}.py, requirements.txt
├── frontend/                       Angular 21 standalone app (no UI/chart libraries)
│   ├── package.json, angular.json, proxy.conf.json, tsconfig*.json
│   └── src/app/{core,shared,pages}/...
└── tests/                          Playwright: unit, integration, e2e (mocked + live), UAT (section 16)
    ├── playwright.config.ts, package.json
    ├── fixtures/                   env, API client, page objects, mock backend + data, closed-loop helpers
    └── unit/ integration/ e2e/mocked/ e2e/live/ uat/
```

### Ports

| Component | Where | Port |
|---|---|---|
| Angular dev server | Windows | 4200 |
| Spring Boot backend | Windows | 8080 |
| PostgreSQL | Windows | 5432 |
| ML service (optional) | Windows or VM | 8001 |
| twin-agent | VM | 8000 |
| OpenDaylight RESTCONF | VM | 8181 |
| OpenDaylight OpenFlow | VM | 6653 |

---

## 1. Hardware and software requirements

| Item | Minimum | Recommended |
|---|---|---|
| Host RAM | 12 GB | 16 GB |
| VM | 4 GB RAM, 2 vCPU, 25 GB disk | 8 GB RAM, 4 vCPU, 40 GB disk |
| CPU | VT-x/AMD-V enabled in BIOS | — |

**Windows host:**

| Software | Version | Purpose |
|---|---|---|
| JDK (Eclipse Temurin or Oracle) | 17 LTS or newer (verified with 23.0.1) | Spring Boot backend |
| Apache Maven | 3.9.x | build backend |
| Node.js | 20.19+, 22.12+ or 24.x (verified on 24.11.1) | Angular 21 |
| Angular CLI | 21.2.x (`npm i -g @angular/cli@21`) | optional; `npx ng` also works |
| PostgreSQL | 14–16 | database (or use the H2 profile) |
| Oracle VirtualBox | 7.x | Ubuntu VM |
| Ubuntu Server/Desktop ISO | 22.04 LTS | Mininet / ODL host |
| OpenSSH client | built into Windows 10/11 | copying files to the VM |
| Python | 3.10+ (only if the ML service runs on Windows) | ML service |

**Ubuntu VM (apt packages):**

| Package | Purpose |
|---|---|
| `mininet` (2.3.x) | network emulation; installs the `mininet` Python 3 module |
| `openvswitch-switch` | OVS software switches |
| `iperf` (iperf **2**) | UDP traffic generation (the agent parses iperf2 output) |
| `python3-venv`, `python3-pip` | twin-agent virtual environment |
| `openjdk-17-jre-headless` | OpenDaylight runtime |
| `coreutils` (`stdbuf`), `iputils-ping` | present by default |

**OpenDaylight:** a Karaf distribution that still ships **OpenFlowPlugin** and **RFC 8040 RESTCONF** (`/rests`). Releases 0.17.x (Chlorine), 0.18.x (Argon) and 0.19.x (Potassium) are known to include both. Choose one and verify it in step 5.3. Do **not** install the `l2switch` features: EDGE-SDN programs forwarding itself.

---

## 2. Windows host installation

1. Install **Temurin JDK 17** (or newer; the build is verified with JDK 23). Tick "Set JAVA_HOME". Verify with `java -version`.
2. Install **Maven 3.9**: unzip it to `C:\tools\maven` and add `C:\tools\maven\bin` to `PATH`. Verify with `mvn -v`, which should show Java 17.
3. Install **Node.js 22 or 24 LTS**. Verify with `node -v` and `npm -v`.
4. (Optional) Run `npm install -g @angular/cli@21`, then verify with `ng version`.
5. Install **PostgreSQL 16**. Remember the password of the `postgres` superuser. Keep port 5432.
6. Install **VirtualBox 7**.

---

## 3. Create the Ubuntu VM and its network

1. Create a new VM: Ubuntu 64-bit, 8 GB RAM, 4 vCPU, 40 GB disk. Install Ubuntu 22.04 from the ISO.
2. VM **Settings → Network**:
   - Adapter 1: **NAT** (internet access for apt/pip inside the VM).
   - Adapter 2: **Host-only Adapter** → `VirtualBox Host-Only Ethernet Adapter` (network `192.168.56.0/24`).
3. Inside the VM, give the host-only NIC the static IP `192.168.56.101`. Find the NIC name with `ip -br link`. It is usually `enp0s8`. Create `/etc/netplan/60-hostonly.yaml`:

   ```yaml
   network:
     version: 2
     ethernets:
       enp0s8:
         dhcp4: false
         addresses: [192.168.56.101/24]
   ```

   Then run:

   ```bash
   sudo chmod 600 /etc/netplan/60-hostonly.yaml
   sudo netplan apply
   ip -br addr show enp0s8        # expect 192.168.56.101/24
   ```
4. From Windows PowerShell, `ping 192.168.56.101` must answer.
5. If you use a different IP, change it everywhere: `edge.agent.base-url` and `edge.odl.base-url` in `application.yml`.

---

## 4. Install Mininet, Open vSwitch and tools in the VM

```bash
sudo apt update
sudo apt install -y mininet openvswitch-switch iperf python3-venv python3-pip \
                    openjdk-17-jre-headless curl unzip
sudo systemctl enable --now openvswitch-switch

# sanity checks
sudo mn --version                     # 2.3.x
sudo mn --test pingall                # must end with "0% dropped"
sudo mn -c                            # clean up
iperf -v                              # "iperf version 2.x"
python3 -c "import mininet; print('mininet OK')"
```

**OpenFlow meter check.** The RATE_LIMIT action uses meters, so confirm they work:

```bash
sudo ovs-vsctl add-br mtest -- set bridge mtest protocols=OpenFlow13
sudo ovs-ofctl -O OpenFlow13 add-meter mtest meter=1,kbps,band=type=drop,rate=1000
sudo ovs-ofctl -O OpenFlow13 dump-meters mtest     # should list meter 1
sudo ovs-vsctl del-br mtest
```

If `add-meter` fails, set `EDGE_OVS_DATAPATH=user` in `twin-agent/agent.env` (step 6). This makes Mininet use the OVS userspace datapath, which always supports meters but is slower.

---

## 5. Install and configure OpenDaylight (in the VM)

1. Download an ODL Karaf distribution zip/tar.gz (see section 1) on a machine with internet and copy it to the VM, or download it directly inside the VM. Then:

   ```bash
   mkdir -p ~/odl && cd ~/odl
   tar xzf karaf-<version>.tar.gz          # or: unzip karaf-<version>.zip
   cd karaf-<version>
   export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
   ./bin/karaf                             # interactive console "opendaylight-user@root>"
   ```
2. In the Karaf console, install **only** the OpenFlow plugin with REST access:

   ```
   feature:install odl-openflowplugin-flow-services-rest
   ```

   This pulls in RESTCONF. Do **not** install `odl-l2switch-*`.
3. Verify from a second VM terminal:

   ```bash
   curl -s -u admin:admin "http://localhost:8181/rests/data/opendaylight-inventory:nodes?content=nonconfig" | head -c 300
   ```

   Before the network starts this returns `{}` or a 404 "data-missing" error. Both are fine, because both prove RESTCONF is up. An HTTP 404 on the whole `/rests` path means the feature did not install.
4. ODL listens for OpenFlow on **6653**. The default credentials are `admin`/`admin`. If you change them, update `edge.odl.username`/`password`.
5. To run ODL in the background next time, use `./bin/start`, then `./bin/client` to open the console. Installed features persist.

---

## 6. Install and start the twin-agent (in the VM)

1. Copy the `twin-agent` folder from Windows to the VM. In PowerShell:

   ```powershell
   scp -r "C:\Users\<you>\...\edge-sdn\twin-agent" <vm-user>@192.168.56.101:~/
   ```
2. In the VM, fix the Windows line endings and permissions, then create the virtual environment. It needs **`--system-site-packages`** so the apt-installed `mininet` module is visible:

   ```bash
   cd ~/twin-agent
   sed -i 's/\r$//' run_agent.sh agent.env.example
   chmod +x run_agent.sh
   cp agent.env.example agent.env
   python3 -m venv --system-site-packages .venv
   .venv/bin/pip install -r requirements.txt
   .venv/bin/python -c "import mininet, fastapi, pydantic; print('agent deps OK')"
   ```

   Offline alternative: run `pip download -r requirements.txt -d wheels` on a connected machine, copy `wheels/` over, then run `.venv/bin/pip install --no-index --find-links wheels -r requirements.txt`.
3. Edit `agent.env`:

   | Variable | Value |
   |---|---|
   | `EDGE_AGENT_TOKEN` | a secret; **must equal** `edge.agent.token` in `application.yml` |
   | `EDGE_CONTROLLER_IP` | `127.0.0.1` (ODL on the same VM) |
   | `EDGE_CONTROLLER_PORT` | `6653` |
   | `EDGE_OVS_DATAPATH` | `kernel` (or `user`, see step 4) |
   | `EDGE_START_LIVE` / `EDGE_START_TWIN` | `1` / `1` |
   | `EDGE_CLEAN_ON_START` | `1` (runs `mn -c` logic at start) |
4. Start ODL first (step 5), then start the agent:

   ```bash
   sudo ./run_agent.sh
   # log ends with: "twin-agent ready (live=True, twin=True, datapath=kernel)"
   ```
5. Verify from Windows PowerShell:

   ```powershell
   curl.exe http://192.168.56.101:8000/health
   curl.exe -H "X-Edge-Token: change-me-agent-token" http://192.168.56.101:8000/topology
   ```

   In the VM, `sudo ovs-vsctl show` lists bridges `c1…a6` (live) and `tc1…ta6` (twin). The live bridges show `is_connected: true` towards `tcp:127.0.0.1:6653`.
6. Check that ODL sees 12 switches:

   ```bash
   curl -s -u admin:admin "http://localhost:8181/rests/data/opendaylight-inventory:nodes?content=nonconfig" \
     | grep -o '"id":"openflow:[0-9]*"' | sort -u
   ```

   Expect `openflow:1, 2, 11–14, 21–26`.

**Emulated campus topology** (defined in `twin-agent/agent/topology.py`):

| Layer | Switches (DPID) | Links |
|---|---|---|
| Core | c1 (1), c2 (2) | c1–c2 50 Mbps |
| Distribution | d1–d4 (11–14) | each to c1 and c2, 30 Mbps |
| Access | a1–a6 (21–26) | uplinks 20 Mbps; a6–d4 50 Mbps |

| Group | Access | Subnet | Hosts | Priority | Nominal users |
|---|---|---|---|---|---|
| EXAM_HALL | a1 | 10.0.1.0/24 | 4 | HIGH | 300 |
| LAB | a2 | 10.0.2.0/24 | 3 | MEDIUM | 180 |
| HOSTEL | a3 | 10.0.3.0/24 | 3 | LOW | 600 |
| ADMIN | a4 | 10.0.4.0/24 | 2 | HIGH | 60 |
| LIBRARY | a5 | 10.0.5.0/24 | 2 | MEDIUM | 120 |
| SERVERS | a6 | 10.0.10.0/24 | 2 | — | — |

A traffic class is the set of downloads from SERVERS to one group. Baseline shortest-path routing sends every class through **c1–d4**, which is therefore the bottleneck under load. The path through **c2** is the alternative route that REROUTE candidates use.

---

## 7. Create the PostgreSQL database (Windows)

Open **SQL Shell (psql)** as `postgres` and run:

```sql
CREATE USER edgesdn WITH PASSWORD 'edgesdn';
CREATE DATABASE edgesdn OWNER edgesdn;
```

Tables are created automatically on the first backend start (`spring.jpa.hibernate.ddl-auto: update`).

**No PostgreSQL?** Run the backend with the H2 file database instead: `--spring.profiles.active=h2` (step 9). The data is stored in `backend/data/`.

---

## 8. Configure the backend (`backend/src/main/resources/application.yml`)

Change at least these keys:

| Key | Set to |
|---|---|
| `spring.datasource.url/username/password` | your PostgreSQL connection |
| `edge.agent.base-url` | `http://192.168.56.101:8000` |
| `edge.agent.token` | the same value as `EDGE_AGENT_TOKEN` |
| `edge.odl.base-url` | `http://192.168.56.101:8181` |
| `edge.odl.username/password` | ODL credentials (`admin`/`admin`) |
| `edge.security.admin-password`, `viewer-password` | change the defaults |

Full reference:

| Key | Default | Meaning |
|---|---|---|
| `edge.telemetry.source` | `ODL` | `ODL` = OpenDaylight port statistics; `AGENT` = interface counters read by the agent (fallback if ODL statistics are empty) |
| `edge.telemetry.poll-interval-ms` | 10000 | polling period |
| `edge.telemetry.retention-hours` | 48 | telemetry and prediction retention |
| `edge.prediction.provider` | `RULE_BASED` | `RULE_BASED` or `ML` (also switchable at runtime in the UI) |
| `edge.prediction.interval-ms` | 60000 | forecast period |
| `edge.prediction.horizons-minutes` | 15, 30, 60 | forecast horizons |
| `edge.prediction.history-minutes` | 30 | history window sent to the provider |
| `edge.prediction.auto-recommend` | true | start the recommendation pipeline automatically when congestion is predicted |
| `edge.ml.base-url` / `timeout-ms` / `api-key` | `http://localhost:8001` / 8000 / "" | ML service |
| `edge.ml.fallback-to-rule-based` | true | use RULE_BASED if the ML service fails |
| `edge.twin.duration-sec` | 8 | traffic replay time per twin run (baseline + each candidate) |
| `edge.twin.min-class-demand-mbps` | 1.0 | minimum per-class load in the twin |
| `edge.twin.max-flow-rate-mbps` | 20 | cap per iperf stream |
| `edge.monitoring.sample-interval-ms` | 15000 | rollback-monitor sampling period |
| `edge.monitoring.consecutive-regressions` | 2 | regressions in a row that trigger rollback |
| `edge.monitoring.probe-count` | 5 | pings per probe |
| `edge.network.auto-init` | true | program baseline routing into ODL when the topology is first loaded |
| `edge.network.meter-burst-kb` | 100 | meter burst size |
| `edge.improvement.*` | 0.35/0.25/0.25/0.15 | KPI-improvement sub-weights (section 12) |
| `edge.risk.*` | 0.30/0.20/0.15/0.15/0.20 | risk sub-weights (section 12) |

The decision parameters (approval mode, score weights, thresholds, rollback limits) are stored in the database and edited on the UI **Policy** page.

---

## 9. Build and run the backend (Windows)

```powershell
cd edge-sdn\backend
mvn -DskipTests package                   # first build downloads dependencies (needs internet once)
java -jar target\edge-sdn-backend-1.0.0.jar
# or without PostgreSQL:
java -jar target\edge-sdn-backend-1.0.0.jar --spring.profiles.active=h2
```

Expected log lines: `Started EdgeSdnApplication`, `Topology loaded from twin-agent (12 switches, 15 links)`.

Checks (PowerShell):

```powershell
curl.exe http://localhost:8080/api/system/ping
curl.exe -u admin:admin123 http://localhost:8080/api/system/health
curl.exe -u admin:admin123 http://localhost:8080/api/topology
```

Also confirm ODL now has the baseline rules:

```bash
# in the VM
sudo ovs-ofctl -O OpenFlow13 dump-flows a1 | head       # table=0 goto + table=1 /32 rules
```

In the VM, check live connectivity through the controller-programmed rules. Mininet has no CLI in this setup, so run a ping from inside a host namespace:

```bash
pid=$(pgrep -f "mininet:h1n1" | head -1); sudo mnexec -a $pid ping -c 3 10.0.10.1
```

---

## 10. Install and run the frontend (Windows)

```powershell
cd edge-sdn\frontend
npm install                     # downloads Angular 21.2 (needs internet once)
npm start                       # = ng serve, with proxy /api → http://localhost:8080
```

Open **http://localhost:4200** and log in:

- `admin` / `admin123`: full control (approve, reject, policy, events, demo).
- `viewer` / `viewer123`: read-only.

For a production build, run `npm run build`. The output goes to `dist/edge-sdn-ui/browser`. Serve it from any web server that proxies `/api` to the backend, or add the UI's origin to `edge.cors-origins`.

---

## 11. First-run checklist and demo walkthrough

**Checklist**

- [ ] VM: ODL running, `feature:list -i | grep openflowplugin` shows the REST feature
- [ ] VM: `sudo ./run_agent.sh` → "twin-agent ready"
- [ ] ODL lists 12 `openflow:*` nodes
- [ ] Backend health: topology loaded, controller reachable, agent UP
- [ ] UI Dashboard shows the topology; link colours appear after about 20 s (two telemetry polls)
- [ ] Audit log contains `TOPOLOGY_LOADED` and `NETWORK_INITIALIZED`

**End-to-end demo (about 10 minutes)**

1. **Network & demo** page → **Exam-surge preset** → **Start traffic**. This starts real UDP load on the live network: EXAM 12, LAB 6, HOSTEL 10, ADMIN 2 and LIBRARY 3 Mbps, about 33 Mbps across the 30 Mbps link c1–d4. The Dashboard turns c1–d4 red.
2. **Institutional events**: the seeded event "Semester Examination" starts 20 minutes after the first backend start. Create a new EXAM event starting in 5 minutes if needed.
3. Wait for the next forecast (60 s), or click **Predictions → Run forecast now**. Link c1–d4 is predicted at ≥ 80 %. Click the row to see the factual factors (baseline, trend, event) and the counterfactuals.
   - If there is too little load for a clear demo, use **Forecast override** on the same page (for example c1–d4 = 0.95). It is labelled *DEMO SCENARIO* everywhere.
4. A recommendation appears in **Recommendations** with status `SIMULATING`. The twin runs the no-action baseline plus up to 3 candidates, about 10 s each. The status then becomes `PENDING_APPROVAL`.
5. Open it and show:
   - 1: the prediction and why action is needed;
   - 2: the human-impact statement;
   - 3: the recommended action and the rejected alternative, the score formula with its numbers, "why this / why not the alternative", the decision counterfactual and the twin KPI table.
6. Click **Approve recommended action**. The status goes `APPROVED → APPLYING → MONITORING`. The rules go into ODL, and you can check them with `sudo ovs-ofctl -O OpenFlow13 dump-flows c2`. The Dashboard shows c1–d4 load dropping.
7. **Rollback demo**: on **Enforcements**, click **Inject regression (demo)**. After 2 samples (about 30 s) the monitor rolls back automatically and the status becomes `ROLLED_BACK`. The audit log labels the regression as injected.
8. **Auto-approval**: on **Policy**, set the approval mode to `AUTO_LOW_RISK` and save. Revert or finish the current enforcement, then trigger a new evaluation. If risk, score, confidence, action type and the hourly limit all pass, the system approves it itself as `SYSTEM:auto-policy`. Otherwise it records the reason in the note and waits for the administrator.
9. **Audit log** → **Verify hash chain** returns "Audit chain intact".

---

## 12. How the decision is computed

### 12.1 Rule-based forecast (no ML)

This is `prediction/RuleBasedPredictionProvider.java`:

```
predicted(h) = EWMA(last 30 min utilisation, α = 0.3)
             + clamp(slope_per_min × h, −0.3, +0.3)
             + Σ events active at now+h:  intensity × typeFactor × activity × affectedShare
   typeFactor:    EXAM 0.7, PLACEMENT 0.6, FESTIVAL 0.8, OTHER 0.4
   activity:      1 inside the event; linear 0→1 during the 10 min before it starts
   affectedShare: affected groups on the link / groups using the link
congestionRisk = sigmoid((predicted − threshold) / 0.04)
uncertainty    = 0.05 + stdev + 0.02·h/15 (+0.05 when an event contributes)
confidence     = clamp(min(1, n/12) × (1 − min(0.6, uncertainty)), 0.2, 0.95)
```

- **Factual explanation:** each additive term is reported as a factor, in percentage points.
- **Counterfactuals:** "without event X the prediction would be Y %", "with a flat trend …", and "load must fall by Z pp to leave the congestion zone". These are exact because the model is additive.

Congestion is detected when `predicted ≥ congestionUtilThreshold` **and** `risk ≥ congestionRiskThreshold` (Policy).

### 12.2 Candidate actions

This is `recommendation/CandidateGenerator.java`. Candidates are generated for each traffic class whose current path crosses the congested link:

- **REROUTE**: the shortest path that avoids the congested link, if one exists. It installs table-0 priority-200 rules on the path switches.
- **RATE_LIMIT**: for non-HIGH classes only. It installs an OpenFlow meter set to `rateLimitFraction` × the predicted demand, at the server access switch.

Classes that already have an active action are skipped. Candidates are interleaved, highest demand first, up to `maxCandidates`. No action ever disables a switch or link.

### 12.3 Digital-twin validation

This is `twin/*` plus `twin-agent/agent/traffic.py`. The twin receives the complete rule set: baseline, plus active actions, plus the candidate. It replays the predicted demand as iperf2 UDP streams, while classes on the target link are scaled so their sum equals the forecast load. The twin measures:

- per-link utilisation from interface counters;
- per-stream delivered Mbps and loss from iperf reports;
- latency from ping probes.

A no-action baseline run is always made first. A candidate the twin could not simulate is `SIMULATION_FAILED` and can never be approved.

### 12.4 Score (fully transparent)

This is `recommendation/ScoringService.java`. All terms are in [0,1]; w1, w2 and w3 come from the Policy page.

```
Score = w1 × KPIImprovement + w2 × Confidence − w3 × Risk          (defaults 0.5 / 0.2 / 0.3)

rel(b, c) = clamp((b − c)/b, −1, 1)
RawImprovement = weighted mean( rel(targetLinkUtil) 0.35, rel(maxLinkUtil) 0.25,
                                rel(protectedLatency) 0.25, lossGain 0.15 )
   lossGain = clamp((bLoss − cLoss)/max(bLoss, 1), −1, 1), 0 if both < 0.5 %
KPIImprovement = clamp(RawImprovement, 0, 1)

Risk = weighted mean( disruption 0.30     = class demand / total demand
                      pathStretch 0.20    = (altHops − baseHops)/baseHops
                      coreTouch 0.15      = share of rules on CORE switches
                      lossSpike 0.15      = clamp((cLoss − bLoss)/10 pp, 0, 1)
                      priorityImpact 0.20 = RATE_LIMIT: priorityWeight × throughput cut of the class
                                            REROUTE: 0.1 × priorityWeight )
   priorityWeight: HIGH 1.0, MEDIUM 0.5, LOW 0.2
Confidence = confidence of the triggering prediction
```

- "Protected" KPIs exclude the class that is deliberately rate-limited in both the baseline and the candidate. That class's throughput cut is counted as risk instead of loss.
- A candidate is **selectable** only if `RawImprovement > minImprovement`.
- Candidates are ranked by score, with lower risk breaking ties. The top-ranked selectable candidate is recommended and the next is shown as the alternative.

### 12.5 Explanations shown to the administrator

These come from `recommendation/ExplanationService.java` and `HumanImpactTranslator.java`:

- **Why selected:** the score equation with the actual numbers, plus the twin KPI deltas.
- **Why not the alternative:** the dominant difference, either weighted improvement or weighted risk (naming its largest risk factor), or the reason it was not eligible.
- **Decision counterfactual (bounded to [0,1]):** the alternative's risk or KPI improvement that would have flipped the choice, and the risk weight w3 at which the choice flips.
- **Human impact:** which user groups move path or are capped, the expected load, response time and loss before and after, and how many nominal users benefit.

### 12.6 Approval, enforcement, monitoring, rollback

- **MANUAL:** the administrator approves the recommended candidate, approves the alternative, or rejects. Recommendations expire after `recommendationTtlMinutes`.
- **AUTO_LOW_RISK:** approval happens only if `risk ≤ autoMaxRisk`, `score ≥ autoMinScore`, `confidence ≥ autoMinConfidence`, the action is in `autoAllowedActions` (default `REROUTE` only), and the count is under `autoMaxPerHour`. Otherwise the recommendation waits for the administrator.
- **Enforcement:** the backend snapshots the configured table 0 of the touched switches, captures live baseline KPIs, then installs meters and flows through the ODL RESTCONF config datastore. If anything fails, it removes what was installed and marks the enforcement FAILED.
- **Monitoring:** every 15 s the backend compares live KPIs with the baseline. A regression is any of:
  - busiest-link utilisation more than `rollbackUtilIncreasePct` above baseline **and** at least 5 pp higher;
  - latency more than `rollbackLatencyIncreasePct` above baseline **and** at least 5 ms higher;
  - probe loss above `rollbackLossPct`.

  Two consecutive regressions trigger an automatic rollback, which deletes exactly the rules and meters of that action so the baseline applies again. With no rollback within `monitorWindowSec`, the action becomes VERIFIED.
- Only one action is applied or monitored at a time, and only one active action is allowed per traffic class.

### 12.7 Audit

Every step is recorded in `audit_event` with the actor (user, `SYSTEM`, `SYSTEM:twin`, `SYSTEM:monitor` or `SYSTEM:auto-policy`). Each row stores `hash = SHA-256(prevHash | ts | actor | type | ids | summary | details)`. `GET /api/audit/verify` recomputes the whole chain to detect tampering.

---

## 13. Backend REST API

Authentication is HTTP Basic. GET endpoints are available to ADMIN and VIEWER; all other methods require ADMIN.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/system/ping` | liveness (no auth) |
| GET | `/api/auth/me` | current user and roles |
| GET | `/api/system/health` | backend, agent, controller, telemetry and provider status |
| GET | `/api/dashboard` | everything the dashboard renders |
| GET / POST | `/api/topology` / `/api/topology/reload` | topology from the agent |
| POST | `/api/network/init` | (re)program baseline routing through ODL |
| GET | `/api/network/status` | controller, agent, live-traffic status |
| GET | `/api/telemetry/latest` | latest link utilisation and group demand |
| GET | `/api/telemetry/history?subjectType=LINK&subjectId=c1-d4&minutes=30` | samples |
| GET/POST/PUT/DELETE | `/api/events`, `/api/events/{id}` | institutional events |
| POST | `/api/events/import` (text/plain CSV) | bulk import |
| GET | `/api/predictions/latest` | latest forecast run |
| POST | `/api/predictions/run` | forecast now (+ pipeline if congested) |
| GET | `/api/predictions/history?linkId=&minutes=` | stored forecasts |
| GET/POST/DELETE | `/api/scenarios`, `/api/scenarios/{id}` | demo forecast overrides |
| POST | `/api/scenarios/live-traffic`, `/api/scenarios/live-traffic/stop` | live demo load |
| GET | `/api/recommendations?status=` | list |
| GET | `/api/recommendations/{id}` | recommendation + all candidates |
| POST | `/api/recommendations/evaluate` | forecast + pipeline now |
| POST | `/api/recommendations/{id}/approve` `{candidateId?, comment?}` | approve (recommended or alternative) |
| POST | `/api/recommendations/{id}/reject` `{reason?}` | reject |
| GET | `/api/enforcements`, `/api/enforcements/{id}` | applied actions |
| POST | `/api/enforcements/{id}/revert` `{reason?}` | manual revert |
| POST | `/api/enforcements/{id}/inject-regression` | **demo only** |
| GET/PUT | `/api/policy` | policy |
| GET | `/api/audit?type=&recommendationId=&page=&size=` | audit log |
| GET | `/api/audit/verify` | verify the hash chain |
| GET | `/api/ml/status` | provider + ML service health/model info |
| PUT | `/api/ml/provider` `{provider: "RULE_BASED" \| "ML"}` | switch provider |
| GET | `/api/ml/explain?linkId=&horizonMinutes=&method=SHAP` | ML explanation pass-through |
| GET | `/api/ml/counterfactual?linkId=&horizonMinutes=&targetUtilization=&maxChanges=` | ML counterfactual pass-through |
| GET | `/api/ml/training-data/telemetry.csv?hours=24` | training-data export |
| GET | `/api/ml/training-data/events.csv` | event export |

**Twin-agent API** (header `X-Edge-Token`, except `/health`): `GET /health`, `GET /topology`, `GET /live/port-stats`, `POST /live/probe`, `POST /live/traffic/start`, `POST /live/traffic/stop`, `GET /live/traffic`, `POST /twin/simulate`, `POST /twin/rebuild`.

---

## 14. ML integration contract

The backend already integrates with the ML service through `ml/MlClient.java` and `ml/MlPredictionProvider.java`. An LSTM + SHAP/LIME implementation only has to satisfy these endpoints. Times are ISO-8601 UTC. Utilisation is a fraction, where 0.85 means 85 %.

| Method | Path | Called by | Purpose |
|---|---|---|---|
| GET | `/api/v1/health` | UI status | `{"status":"UP","modelVersion":"..."}` |
| GET | `/api/v1/model-info` | UI status | free-form model metadata |
| POST | `/api/v1/predict` | every forecast cycle (when provider = ML) | forecasts + factual explanation + counterfactuals |
| POST | `/api/v1/explain` | `/api/ml/explain` | detailed SHAP/LIME explanation for one link and horizon |
| POST | `/api/v1/counterfactual` | `/api/ml/counterfactual` | bounded counterfactual search |

Optional header: `X-Api-Key` (`edge.ml.api-key` ↔ `EDGE_ML_API_KEY`).

**POST /api/v1/predict**

Request (identical to `PredictionModels.PredictionInput`):

```json
{
  "generatedAt": "2026-10-05T04:10:00Z",
  "horizonsMinutes": [15, 30, 60],
  "congestionThreshold": 0.8,
  "links": [
    { "linkId": "c1-d4", "capacityMbps": 30.0,
      "groups": ["EXAM_HALL", "LAB", "HOSTEL", "ADMIN", "LIBRARY"],
      "history": [ { "ts": "2026-10-05T03:40:10Z", "utilization": 0.61 } ] }
  ],
  "events": [
    { "id": 1, "name": "Semester Examination", "type": "EXAM", "startTime": "2026-10-05T04:30:00Z",
      "durationMinutes": 180, "expectedIntensity": 0.85, "affectedGroups": ["EXAM_HALL"] }
  ]
}
```

Response (one entry per link × horizon):

```json
{
  "modelVersion": "lstm-v1",
  "predictions": [
    { "linkId": "c1-d4", "horizonMinutes": 30, "predictedUtilization": 0.91,
      "lower": 0.84, "upper": 0.97, "congestionRisk": 0.93, "confidence": 0.78,
      "explanation": { "method": "SHAP", "summary": "exam event dominates",
        "factors": [ { "name": "event:Semester Examination", "value": 0.85,
                       "contribution": 0.22, "description": "..." } ] },
      "counterfactuals": [ { "description": "Without the exam event: 69%", "predictedUtilization": 0.69 } ] }
  ]
}
```

**POST /api/v1/explain**: `{ "input": <PredictionInput>, "linkId": "c1-d4", "horizonMinutes": 30, "method": "SHAP" }`, which returns any JSON (shown raw).

**POST /api/v1/counterfactual**: `{ "input": <PredictionInput>, "linkId": "c1-d4", "horizonMinutes": 30, "targetUtilization": 0.7, "maxChanges": 2 }`, which returns any JSON.

**Behaviour in the backend**

- The backend clamps all values and drops unknown links.
- If the ML call fails and `edge.ml.fallback-to-rule-based=true`, the RULE_BASED provider is used and a `PREDICTION_FALLBACK` audit entry is written.
- The provider is switched on the **Predictions** page or with `PUT /api/ml/provider`.
- Training data is exported from `/api/ml/training-data/*.csv`.

**Running the skeleton.** It uses a persistence placeholder that is not ML, with confidence fixed at 0.3:

```powershell
cd edge-sdn\ml-service
python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\uvicorn app.main:app --host 0.0.0.0 --port 8001
```

To add the real model, implement `LstmForecaster(Forecaster)` in `ml-service/app/model.py` (see the TODO there) and assign it to `MODEL`. The REST contract does not change.

---

## 15. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Backend log: `Topology not loaded … unreachable` | The agent is not running, the IP is wrong, or the VM firewall blocks it. Check `curl http://192.168.56.101:8000/health` from Windows. |
| `HTTP 401 invalid agent token` | `edge.agent.token` ≠ `EDGE_AGENT_TOKEN`. |
| Agent: `must run as root` | Start it with `sudo ./run_agent.sh`. |
| Agent: `No module named mininet` | The venv was created without `--system-site-packages`; recreate it. |
| `run_agent.sh: /usr/bin/env: 'bash\r'` | Windows line endings; run `sed -i 's/\r$//' run_agent.sh agent.env`. |
| ODL shows no `openflow:*` nodes | ODL started after the agent, or the OpenFlow feature is missing. Restart the agent after ODL is up; check that `sudo ovs-vsctl show` has `is_connected: true`. |
| `NETWORK_INITIALIZED` with errors / `HTTP 404` on `/rests/...` | The ODL release lacks RFC 8040 RESTCONF, or `edge.odl.data-path` is wrong. The code needs `/rests/data` (the older `/restconf/config` format is **not** supported). |
| Telemetry always stale with `source: ODL` | ODL statistics not collected. Set `edge.telemetry.source: AGENT`. |
| RATE_LIMIT candidates are `SIMULATION_FAILED` with an `add-meter` error | Set `EDGE_OVS_DATAPATH=user`, restart the agent. |
| All candidates `NO_GAIN` | There was too little load in the twin. Start live traffic (preset) or inject a forecast override ≥ 0.9, or lower `minImprovement`. |
| Pings fail between hosts after a manual change | Use **Network & demo → (Re)initialise baseline routing**. |
| `mn -c` removed the live network | Never run `mn -c` while the agent runs; restart the agent. |
| Angular: `Backend unreachable` | The backend is not on 8080, or you did not start with `npm start` (which uses the proxy). |
| Browser login loop | Wrong credentials, or the backend restarted with new passwords. |
| Maven build fails inside Lombok on a newer JDK | Use Lombok ≥ 1.18.48 (already set in `pom.xml`). The build is verified with JDK 23.0.1 and Maven 3.9. |
| IDE marks Spring classes as unresolved | Maven dependencies are not downloaded yet; run `mvn -DskipTests package` once. |
| Playwright: `browserType.launch: Executable doesn't exist` | Run `npx playwright install chromium` in `edge-sdn/tests`. |
| Playwright: network suites all "skipped" | The twin-agent or OpenDaylight is not reachable from the backend. Expected on a Windows-only setup; set `EDGE_REQUIRE_NETWORK=1` to make them fail instead. |

---

## 16. Automated tests (Playwright)

The tests live in **`edge-sdn/tests/`**, a separate npm project, so the application itself has no test dependencies. All suites use the Playwright test runner. Only the browser suites start Chromium.

> **Status:** the suites are written but have **not been executed yet**, because Playwright was not installed. On the first run, expect a few selector or timing adjustments.

### 16.1 Test levels

| Project | What it tests | What must be running |
|---|---|---|
| `unit` | Framework-free frontend logic: formatting, status colours, error messages, event-form validation and conversion, policy coercion, demo-traffic helpers, sparkline maths, topology layout, session storage | nothing |
| `integration` | REST contracts: backend security/RBAC, error format, CORS, events (CRUD, validation, CSV import), policy validation, hash-chained audit log, recommendations/enforcements/scenarios, ML endpoints, training-data export, twin-agent contract, ML-service contract | backend (+ twin-agent / ML service for their suites) |
| `e2e-mocked` | Real Angular UI in Chromium, with `/api` answered by a stateful in-browser mock. Covers the recommendation review (explanations, recommended vs alternative, approve/reject, conflicts, viewer), dashboard topology colours, enforcement revert and rollback demo, predictions and fallback, telemetry chart, demo controls | Angular dev server only |
| `e2e` | Real UI + real backend: login/logout/session/401, role-based UI, event workflow, policy workflow, audit UI, navigation, behaviour without the twin-agent | frontend + backend |
| `uat` | Acceptance scenarios (Given/When/Then, tagged `@uat`). **UAT-01…05** governance (sign-in and status, event registration, controlled automation, read-only viewer, tamper-evident audit). **UAT-06…09** closed loop on the emulated network (approve → enforce → monitor → verify, automatic rollback, reject, auto-approval policy). **UAT-10** ML fallback | frontend + backend; UAT-06…09 also need twin-agent + OpenDaylight; UAT-10 needs the twin-agent |

Suites that need Mininet/OpenDaylight (or the twin-agent / ML service) **skip themselves** when that part is unavailable, with the reason in the report. Set `EDGE_REQUIRE_NETWORK=1`, `EDGE_REQUIRE_AGENT=1` or `EDGE_REQUIRE_ML=1` to make them fail instead, for example on the full demo machine.

### 16.2 One-time installation (not done yet)

```powershell
cd edge-sdn\tests
npm install                        # installs @playwright/test
npx playwright install chromium    # browser used by e2e-mocked, e2e and uat
```

### 16.3 Running

Start what the level needs (see 16.1), then:

```powershell
npm run test:unit            # no servers needed
npm run test:integration     # backend on :8080 (twin-agent / ML suites skip if absent)
npm run test:e2e:mocked      # Angular dev server on :4200 only
npm run test:e2e:live        # dev server + backend
npm run test:uat             # dev server + backend (+ VM for UAT-06…09)
npm test                     # everything
npm run report               # opens the HTML report (reports/html)
```

- Setting `$env:EDGE_START_UI = '1'` makes Playwright start (or reuse) the Angular dev server itself.
- A JUnit report is written to `reports/junit.xml`. Traces, screenshots and videos are kept for failed tests in `test-results/`.

### 16.4 Test configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `EDGE_UI_URL` | `http://localhost:4200` | frontend |
| `EDGE_BACKEND_URL` | `http://localhost:8080` | backend |
| `EDGE_AGENT_URL` / `EDGE_AGENT_TOKEN` | `http://192.168.56.101:8000` / `change-me-agent-token` | twin-agent contract suite |
| `EDGE_ML_URL` / `EDGE_ML_API_KEY` | `http://localhost:8001` / empty | ML-service contract suite |
| `EDGE_ADMIN_USER` / `EDGE_ADMIN_PASSWORD` | `admin` / `admin123` | administrator credentials |
| `EDGE_VIEWER_USER` / `EDGE_VIEWER_PASSWORD` | `viewer` / `viewer123` | viewer credentials |
| `EDGE_REQUIRE_NETWORK` / `_AGENT` / `_ML` | unset | `1` = fail instead of skip when that part is missing |

### 16.5 Test data and side effects

- Every record the tests create is named `PW-TEST …` and deleted afterwards.
- The policy and the prediction provider are restored after the suites that change them.
- The closed-loop UATs clear demo scenarios, reject pending recommendations, revert active actions and re-program the baseline routing before and after they run.
- The suites change global settings for a short time, so run them against a test instance, **not during a live demo**. They run serially (`workers: 1`) because they share one backend.

### 16.6 Frontend changes made for testability

The pure logic was moved out of the Angular components into framework-free modules, so the unit tests can import them without Angular:

| Module | Used by |
|---|---|
| `core/utils.ts` | error messages, status colours, formatting, Basic-auth header (now UTF-8 safe), refresh logic, audit filter |
| `core/event-form.ts` | the events page (it now also validates name, duration and intensity in the browser before sending) |
| `core/policy-form.ts` | the policy page (an emptied field is sent as `null`, so the backend rejects it instead of storing 0) |
| `core/demo-helpers.ts` | the Network & demo page (an all-zero traffic demand is refused in the browser) |
| `shared/sparkline-geometry.ts`, `shared/topology-layout.ts` | the chart and topology components |

After the refactor the frontend still compiles without errors.

---

## 17. Assumptions and known limitations

These are stated honestly for the report and viva.

1. **The SRS/synopsis documents were not available** when this was written, so requirements come from the project brief. Where the brief was ambiguous, the simplest option was chosen:
   - traffic classes are downloads from the server farm to client groups;
   - the actions are REROUTE and RATE_LIMIT;
   - there is one congested link per recommendation;
   - one action is applied or monitored at a time.
2. **No ML yet.** Forecasts come from a transparent rule-based model. The ML service is a contract skeleton, and the placeholder is labelled as such in `model-info`.
3. **Emulated network only:** a Mininet campus with 12 switches, 15 links and 16 hosts, plus small link capacities (20–50 Mbps) so a laptop can saturate them. No physical hardware is involved.
4. **The digital twin is a structural copy** of the live topology, with the live rule set and predicted demand replayed as UDP. It does not model TCP dynamics or application behaviour.
5. **OpenDaylight only** is implemented, behind the `SdnControllerClient` interface. Only the RFC 8040 RESTCONF JSON format is supported.
6. **Security is prototype level:** HTTP Basic with two in-memory users, a shared token for the agent, and plain HTTP.
7. **Demo aids are explicit and labelled:** forecast overrides, live traffic generation and injected regressions. They never masquerade as measured data.
8. Rollback removes exactly the rules and meters that EDGE-SDN added. It cannot undo changes made outside EDGE-SDN.
