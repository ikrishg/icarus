export type Point = { x: number; y: number };

export type ObstacleDef =
  | { type: 'platform'; x: number; y: number; w: number; h: number }
  | { type: 'spikes'; x: number; y: number; count: number; size: number }
  | { type: 'lava'; x: number; y: number; w: number; h: number }
  | {
    type: 'laser';
    x: number;
    y: number;
    w: number;
    h: number;
    delay?: number;
  }
  | {
    type: 'movingEnemy';
    x: number;
    y: number;
    w: number;
    h: number;
    range: number;
    speed: number;
  };

export interface LevelDefinition {
  name: string;
  instruction?: string;
  start: Point;
  goal: Point;
  obstacles: ObstacleDef[];
}
