# MINEHIVE — MASTER PROMPT VOL 7
## AUTONOMOUS COLONY, RESOURCE ECONOMY, LOGISTICS & INFRASTRUCTURE

VOL 7 memperluas:
- 16 HiveMind
- 17 Multi Bot
- 14 Memory System
- 12 AI System
- 15 Machine Learning
- 19 API
- 20 Database
- 22 Testing

Target: MineHive mampu menjalankan koloni yang dapat mengatur resource, produksi, transportasi, pembangunan, dan maintenance secara autonomous.

---

# 1. COLONY SYSTEM

Buat:
```text
src/colony/
├── colony.js
├── colony-manager.js
├── colony-state.js
├── colony-config.js
├── colony-health.js
└── colony-events.js
```

Colony:
```js
{
  id,
  name,
  status,
  agents,
  teams,
  goals,
  resources,
  infrastructure,
  territory,
  statistics
}
```

---

# 2. ROLE SYSTEM

Role:
- miner
- builder
- farmer
- scout
- combat
- courier
- engineer
- trader
- crafter
- coordinator

Role harus menentukan:
- capabilities
- preferred tasks
- equipment hints
- priority profile

---

# 3. DYNAMIC WORKFORCE

```text
src/colony/workforce/
├── workforce-manager.js
├── demand-analyzer.js
├── role-assignment.js
└── workload-balancer.js
```

Pertimbangkan:
- capability
- distance
- health
- workload
- reliability
- equipment
- priority

---

# 4. RESOURCE ECONOMY

```text
src/economy/
├── resource-manager.js
├── resource-ledger.js
├── reservation.js
├── allocation.js
├── demand.js
├── supply.js
└── forecasting.js
```

Support:
- reserve
- allocate
- consume
- transfer
- release
- forecast

Tidak boleh terjadi double-spending.

---

# 5. RESOURCE PRIORITY

```text
survival
>
defense
>
food
>
critical tools
>
infrastructure
>
expansion
>
optional
```

Priority configurable.

---

# 6. LOGISTICS

```text
src/logistics/
├── route-manager.js
├── transport-planner.js
├── courier-manager.js
├── warehouse-manager.js
└── logistics-optimizer.js
```

Flow:
```text
Production
 -> Storage
 -> Reservation
 -> Transport
 -> Destination
 -> Verification
```

---

# 7. INFRASTRUCTURE

```text
src/infrastructure/
├── infrastructure.js
├── infrastructure-manager.js
├── construction-planner.js
├── maintenance-manager.js
└── types/
```

Infrastructure:
- warehouse
- farm
- mine
- workshop
- smelter
- outpost
- road
- bridge
- wall
- tower
- storage

Lifecycle:
```text
PLANNED
CONSTRUCTION
ACTIVE
DAMAGED
MAINTENANCE
ABANDONED
DESTROYED
```

---

# 8. MAINTENANCE

Monitor:
- health
- capacity
- efficiency
- age
- resource cost

Decision:
```text
repair
replace
upgrade
abandon
```

---

# 9. PROJECT SYSTEM

```text
src/projects/
├── project.js
├── project-manager.js
├── milestone.js
├── dependency-graph.js
└── project-evaluator.js
```

Project contoh:
```text
Automated Farm
 -> land
 -> seeds
 -> water
 -> structure
 -> storage
 -> verification
```

---

# 10. ECONOMIC PREDICTION

Prediction:
- shortage
- surplus
- production rate
- consumption rate
- transport cost
- growth demand

Gunakan ML bila tersedia, fallback ke heuristic.

---

# 11. COLONY DASHBOARD DATA

Expose:
- agents
- roles
- workload
- resources
- production
- logistics queue
- infrastructure health
- project progress

---

# 12. TESTING

Wajib:
- resource reservation
- allocation
- transfer
- workforce assignment
- logistics routing
- infrastructure lifecycle
- maintenance
- project dependency
- economic forecasting

---

# 13. DEFINITION OF DONE

[ ] Colony Runtime
[ ] Workforce
[ ] Dynamic Roles
[ ] Resource Economy
[ ] Reservations
[ ] Logistics
[ ] Infrastructure
[ ] Maintenance
[ ] Projects
[ ] Economic Forecasting
[ ] API integration
[ ] Persistent state
[ ] Tests
