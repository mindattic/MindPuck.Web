import type { Polygon, Vec } from './geometry.js';

/**
 * World units. The table is 16 by 9 with the origin at its top-left corner and y pointing down,
 * so a normalized gaze point (0..1) times (16, 9) is a table position.
 */
export const ARENA_W = 16;
export const ARENA_H = 9;
export const PUCK_R = 0.42;
export const GOAL_R = 1.1;

export interface Goal extends Vec {
  /** Radius of the goal pad. */
  r: number;
}

export interface Level {
  seed: number;
  index: number;
  width: number;
  height: number;
  puckRadius: number;
  start: Vec;
  goal: Goal;
  /** "zone" is an open pad. "cup" is a pad inside a box with one side missing. */
  kind: 'zone' | 'cup';
  /** For a cup, the direction its open side faces, in radians. */
  cupAngle: number;
  /** Everything the puck bounces off, the cup's walls included. */
  obstacles: Polygon[];
  /** How long the solver took to win in repulsor mode, in seconds. Shown to the player as the time to beat. */
  par: number;
  /** The same for magnetic mode. */
  parAttract: number;
  /** The same for steer mode. */
  parSteer: number;
  /** How many candidates were generated before one passed the solver. */
  attempts: number;
}
