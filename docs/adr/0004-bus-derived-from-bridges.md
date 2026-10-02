# A bus is derived from bridges and nets stay one per wire run

The RAMMP team asked for the 48 V rail to read as one thing: twelve two-connector nets off the bus bar are one rail in the engineer's head. Making them one stored net breaks the routing model. A connector ends exactly one segment and no segment crosses a component, so a net listing BAT, L1 to L10 and ten loads routes as three disconnected pieces and the unrouted-net error fires on a correct design. Instead a component definition lists bridges, groups of connectors the device joins inside itself, and a bus is the set of nets reached by walking nets and bridges. The harness builds nets; the machine builds buses. Nothing about routes, harnesses, design rule checks or the BOM changes, and the engineer keeps one net per wire run so each run gets its own length in the topology. The in-line switch bridges IN to OUT, since an open switch is a fault state rather than a design state, so the bus runs from the battery to the last load. The MIB and the RoboClaws bridge CAN-A to CAN-B, so the CAN chain is a bus too, which is why the term is bus rather than rail. The bus name is optional and anchored on one member net, following the harness naming pattern; an unnamed bus is labelled "48 V bus via Bus bar". The return conductor stays the second conductor of the pair, not a net of its own. Issue #17 holds the full grill.

## Considered options

- One literal multi-drop net with branch points at splices. Rejected: the branch happens inside the bus bar, where no splice can sit, and the route comes out disconnected.
- The bus bar modelled as a splice. Rejected: the ring terminals on each lug drop out of the BOM, and the three power pieces merge into one harness that cannot be lifted off the robot as one piece.
- A stored rail that owns a list of nets. Rejected: a second record of what the bus bar already states, which drifts the first time a load moves to another lug.
- One boolean on the definition saying all connectors are joined. Rejected: the RoboClaw bridges its two CAN connectors and must not join them to PWR.
- The bus named on the bridging component. Rejected: the 48 V bus has two bridging components once the switch joins.
- A separate negative net per load. Rejected: doubles the net count for no harness information, and #20 gives the return its colour as a conductor.
