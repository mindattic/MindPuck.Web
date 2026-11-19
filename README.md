# MindPuck

Move the puck into the goal by looking where you don't want it to go.

Your gaze is a repulsor: a reverse black hole. Wherever you look, the puck is pushed away from that
point, harder the closer you look. Look behind the puck and it slides forward. Look far away and it
glides on its own, like a puck on an air-hockey table. Bring it to rest on the amber pad.

This is the web version, drawn with three.js. Eye tracking comes from
[MindAttic.EyeTracker](https://github.com/mindattic/MindAttic.EyeTracker), using the webcam of the
computer you play on or the camera of a phone. A mouse or a finger can stand in for your eyes.

The same game exists for Unity ([MindPuck.Unity](https://github.com/mindattic/MindPuck.Unity)) and
Unreal ([MindPuck.Unreal](https://github.com/mindattic/MindPuck.Unreal)), with the same rules,
physics numbers and level generator.

## Run it

MindPuck expects the EyeTracker repo checked out beside it:

```
D:\Projects\MindAttic\MindAttic.EyeTracker
D:\Projects\MindAttic\MindPuck
```

PowerShell:

```powershell
cd D:\Projects\MindAttic\MindAttic.EyeTracker
npm install
npm run build
cd D:\Projects\MindAttic\MindPuck
npm install
npm start
```

`npm start` builds the game and serves it from the EyeTracker bridge, then opens
`http://localhost:8787/play/`. You should see the title card with three ways to play:

- **Use this camera**: asks for the webcam, then runs a nine-dot calibration. Look at each dot
  until it fills.
- **Use my phone**: the phone's camera watches your eyes while you look at this screen. The status
  line at the bottom shows the address to open on the phone (same Wi-Fi; accept the certificate
  warning once). Prop the phone at the bottom or top of the screen, facing you, start its camera,
  then press **C** here to calibrate.
- **Use the pointer**: no camera. The mouse or your finger is the gaze point.

For development with live reload, `npm run dev` serves the game alone on `http://localhost:5183`.
The webcam and pointer work there. For a phone, run the bridge as well
(`cd D:\Projects\MindAttic\MindAttic.EyeTracker; npm run bridge`).

## Controls

| Key | Button | Does |
| --- | --- | --- |
| R | Restart | Put the puck back at the start |
| N | Skip | Go to the next level |
| B | Show me | The solver plays the level, showing where it looks |
| C | Calibrate | Run the eye tracking calibration again |
| Esc | Input | Change how you play |
| F | | Fullscreen |

The run's seed and level are remembered between visits. To share or replay a run, add them to the
address: `?seed=1234&level=5`.

## How it works

- `src/core/` holds the rules and nothing else: the physics (`physics.ts`), the level generator
  (`levelgen.ts`), route finding (`navgrid.ts`) and the solver (`bot.ts`). It has no browser or
  three.js dependency.
- `src/game/` draws the table with three.js and makes the sounds.
- `src/main.ts` wires the gaze sources, the menu and the game loop together.

Every level is generated from the seed, then **played by a solver before you see it**. The solver
steers the puck with a simulated gaze point that wobbles and lags the way a real eye tracker does.
A level the solver cannot win is thrown away and another is generated. The solver's time is the
par shown in the corner. [docs/DESIGN.md](docs/DESIGN.md) has the details and every tuning number.

`npm run levels` prints a run of levels and how the solver did:

```
level  9  cup   obstacles 11  par   7.0s  candidates  1  reruns won 5/5  2 ms
```

## Build and test

- `npm run build` typechecks and builds to `dist/`.
- `npm test` runs the unit tests (vitest) for the physics, collisions, route finding, level
  generation and the solver.
