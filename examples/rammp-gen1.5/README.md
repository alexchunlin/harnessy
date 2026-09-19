# RAMMP Gen 1.5 example project

This folder reproduces the connectivity of `docs/reference/rammp-gen1.5-diagram.png` with the corrections in `DESIGN.md`: six fisheye cameras on GMSL, four encoders on PWM, no UART, no PoE, and a CAN bus that daisy-chains with purchased patch cables.

Every file here is generated. Do not edit by hand; change `scripts/build-rammp-example.ts` and run `pnpm build:example`. Ids are sequential so a re-run writes an identical tree.

## Lengths are placeholders

Every segment length in `topologies/` is a placeholder typed into the script. Nobody has laid rope on the robot yet. Purchased cables take their length from the library entry.

## What is in it

One topology, "Gen 1.5 as built", routes all 72 nets. It holds 14 built harnesses (battery leads, two 48 V power harnesses, the MIB sensor harness, three RoboClaw axis harnesses, four drive corner harnesses, and the 24 V harness) plus 23 purchased cables for Ethernet, CAN, USB, HDMI, and GMSL.

The design rule check reports no errors and three warnings: two spare ports on the USB hub and the spare CAN connector at the end of the chain.

## Judgment calls

The diagram leaves some things unreadable. The script makes these choices:

- The Jetson sits on a carrier with six FAKRA GMSL2 inputs. The unpowered USB hub for the UVC cameras is gone.
- The 24 V DC/DC has four outputs: Kinova Gen3, the powered USB hub, the Jetson, and the joystick. The joystick and Jetson were PoE powered in the diagram.
- The battery BMS sits on the CAN chain as a hop off the MIB's second CAN connector.
- The front lift motor is driven by the rear RoboClaw's second channel. Each RoboClaw channel has an ABZ encoder, six in total.
- Four PWM absolute encoders (one per lift axis) report to the MIB. The diagram shows two encoders wired to the MIB.
- All four limit switch pairs wire to the MIB as digital I/O.
- The in-line switch and fuse carries both battery conductors between XT90 connectors.
- Bus bar positions are M6 stud pairs, one positive and one negative per load.
- Strain gauge nets use a 4-core shielded cable so the 10 V supply travels with the signal.
