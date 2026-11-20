# MindPuck design

This is the reference for the rules. The web, Unity and Unreal versions implement the same thing;
`src/core/` in this repo is the original and the other two are ports of it.

## The table

World units. The table is 16 wide and 9 deep, origin at the top-left corner, `y` pointing down the
screen. A normalized gaze point (0..1 on each axis, as MindAttic.EyeTracker reports it) is turned
into a table point by casting a ray from the camera through that screen position onto the table.
The gaze point may land up to 1.5 units outside the table.

The puck is a circle of radius 0.42. The goal pad is a circle of radius 1.1.

## Control schemes

`PuckSim.mode` is `attract` (magnetic, the default), `steer` or `repel`. F1 steps through
`GAZE_MODES` during play, and the HUD names the one in use at the bottom centre.

To add a scheme: add its name to `GazeMode` and `GAZE_MODES`, give it an acceleration in
`PuckSim.step` and a way of aiming in `SolverBot.decide`, add its par to `Level` and its solve to
`verify` in `levelgen.ts`, and give it a name, colour and one-line help in `src/main.ts`.

### Magnetic

The gaze point pulls the puck toward itself:

```
pull(d) = pullStrength * min(d / pullSoftness, 1)
```

- `pullStrength` 14: the pull once the puck is more than `pullSoftness` away.
- `pullSoftness` 1.5: inside this distance the pull shrinks in proportion to the distance, like a
  spring, so the puck settles on the gaze point instead of being flung through it.
- `pullDrag` 3.5: extra drag while the gaze is holding the puck. Without it the puck would circle
  the point it is pulled to.

The pull has no range limit. To win, look at the pad.

### Steer

You look at the puck itself, and it is driven toward the side of it you are looking at:

```
steer(d) = steerStrength, shaped by the distance d from the centre of the puck to the gaze point:
           0 inside the dead zone (0.3 radii), rising to full at steerFull (1.5 radii),
           full out to steerRange (4 radii), then fading to 0 at 6 radii
```

- `steerStrength` 9, `steerFull` 1.5, `steerRange` 4, `steerDrag` 1.2.
- Looking at the centre of the puck, or well away from it, leaves it alone.
- The direction is the line from the centre of the puck to the gaze point, so the eyes stay on the
  puck and follow it as it moves.

### Repulsor

The gaze point pushes the puck directly away from itself. With `d` the distance from the gaze point
to the puck's centre, the acceleration is

```
push(d) = strength / (1 + (d / softness)^2)  *  (1 - d / range)^2  *  centre(d)
```

- `strength` 40: the peak push, in units per second squared.
- `softness` 2: the distance at which the first term has halved. The field is wide, so a gaze
  point a few units behind the puck still steers it, and at that distance a tracking error of half
  a unit changes the direction only slightly.
- `range` 6: beyond this the gaze does nothing. Looking far away is how you let go.
- `centre(d)`: a smooth ramp from 0 to 1 over the inner 30% of the puck's radius. Looking at the
  exact centre gives no push, because there is no direction to push in.

While the eyes are not tracked (no face, or a blink) there is no push.

Close in, the push is strong and its direction is touchy: look at the left edge of the puck and it
shoots right. Far out, it is gentle and steady. That trade is the game.

## Motion

A fixed step of 1/120 second:

1. Add the push to the velocity.
2. Drag: multiply the velocity by `exp(-drag * dt)`. Drag is 0.55 per second on the table (a long
   glide) and 3.5 on the goal pad (which is what lets the puck stop there).
3. Friction: take a constant 0.06 off the speed, so a slow puck really stops.
4. Cap the speed at 14.
5. Move.
6. Resolve collisions.

## Collisions

Obstacles are polygons, convex or concave. Each is a loop of segments. For every segment the puck
overlaps, find the point on the segment closest to the puck's centre; the direction from that point
to the centre is the contact normal. Move the puck out along it until it only touches, and reflect
the velocity:

- the part going into the wall is reversed and multiplied by the restitution, 0.82;
- the part sliding along the wall loses 3%.

A corner is simply the end of a segment, so the same test gives the right bounce off faces and
corners. Up to four passes settle the puck when it touches two walls at once. The step is much
smaller than the puck (0.117 units at top speed against a radius of 0.42), so the puck cannot pass
through a wall between steps. The table's own edges are handled the same way.

## Winning

The puck wins when its centre stays within 0.85 of the goal's centre (the pad's radius less 60% of
the puck's) at a speed under 1.5 for half a second. Flying across the pad does not count.

A goal is one of two kinds:

- **zone**: an open pad.
- **cup**: a pad inside a box with one side missing. The three walls are ordinary obstacles.

## Level generation

`generateLevel(seed, index)` is deterministic. For attempt 0, 1, 2... it seeds a generator with
`mixSeed(seed, index, attempt)`, builds a candidate and verifies it. The first candidate that
passes is the level.

A candidate, for level index `d`:

- The puck starts in one quarter of the table and the goal sits in the opposite third.
- From level 2, half the goals are cups. Until level 4 the cup opens toward the puck; after that
  it may be turned up to 90 degrees away.
- From level 4, gates appear: a wall across the table with one gap. The gap narrows as `d` grows,
  never below 1.7 puck diameters.
- `min(1 + floor(0.7 d), 8)` loose obstacles: bars, triangles, pentagons, hexagons, L shapes and
  rocks, at random positions and angles. Each must stay clear of the puck's start and the goal,
  and must either overlap its neighbours or leave a gap of at least a puck's diameter plus 0.25,
  so there are no slots the puck could jam in.

## Proof that a level can be won

Verification has two stages.

1. **Route.** The table is cut into 0.25-unit cells. A cell is free if the whole puck fits there.
   A* (eight directions, no corner cutting) must find a route from the start to the goal.
2. **Play.** A solver bot plays the level with the real physics. Twice a second it finds a route
   from where the puck is now and heads for the farthest point on it that it can reach in a
   straight line. Thirty times a second it decides where to look: it works out the acceleration
   it wants (toward the target at a cruising speed of 3.2, slowing on the last leg), and places
   its gaze point behind the puck at the distance where the push equals that acceleration. The
   gaze point has to be on the table, so near a wall it looks at the wall's edge instead.

   The bot's gaze is not perfect. It reaches a new point with a lag of 0.12 seconds and carries a
   wandering error with a standard deviation of 0.4 units (2.5% of the table's width), which is
   about what a calibrated webcam tracker gives.

   The bot has 75 simulated seconds.

   It plays the level once in each mode: repulsor as described; magnetic, where it simply looks at
   the next point on its route; and steer, where it looks just off the puck on the side it wants
   it to accelerate toward. All three must win. The times are the level's `par`, `parAttract` and
   `parSteer`.

In practice the first candidate nearly always passes, and the levels stay winnable when the bot's
error is tripled (`npm run levels` reruns each level with other noise seeds to show this).

## Tuning

Every number above lives in `DEFAULT_PARAMS` (`src/core/physics.ts`), `DEFAULT_BOT`
(`src/core/bot.ts`) or the constants at the top of `src/core/levelgen.ts`. Change them in all three
versions together: the ports use the same names.
