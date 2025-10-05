export type Point = { x: number; y: number };

export type ObstacleDef =
	| { type: 'platform'; x: number; y: number; w: number; h: number }
	| { type: 'spikes'; x: number; y: number; count: number; size: number }
	| { type: 'lava'; x: number; y: number; w: number; h: number }
	| {
			type: 'movingEnemy';
			x: number;
			y: number;
			w: number;
			h: number;
			range: number;
			speed: number;
	  }
	| {
			type: 'fireball';
			x: number;
			y: number;
			delay?: number;
			interval?: number;
	  };

export type AbilityType =
	| 'flight' // Double jump
	| 'jump' // Single jump
	| 'vision' // Perfect vision
	| 'dimVision' // Dim vision
	| 'dash' // Can dash
	| 'moveLeft' // Can move left/back
	| 'arrows'; // Can shoot arrows

export type AbilityTier = {
	flight: 'flight' | 'doubleJump' | 'jump' | 'none';
	vision: 'perfect' | 'dim' | 'blur';
	dash: 'dash' | 'noDash' | 'slow';
	moveLeft: 'can' | 'cannot';
	arrows: 'can' | 'cannot';
};

export interface PlayerAbilities {
	jumpLevel: 0 | 1 | 2 | 3; // 3=flight, 2=double, 1=single, 0=none
	visionLevel: 0 | 1 | 2; // 2=perfect, 1=dim, 0=blur
	dashLevel: 0 | 1 | 2; // 2=dash, 1=normal, 0=slow
	canMoveLeft: boolean;
	canShootArrows: boolean;
}

export interface LevelDefinition {
	name: string;
	instruction?: string;
	start: Point;
	goal: Point;
	obstacles: ObstacleDef[];
	isLoseLevel?: boolean; // Player chooses which ability to lose
	isGainLevel?: boolean; // Player gains 3 abilities back
}
