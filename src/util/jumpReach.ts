import { LEVELS } from '../data/levels';
import type { LevelDefinition } from './types';

/** Match Player + main.ts physics. */
export const JUMP_VELOCITY = 550;
export const GRAVITY = 800;
export const GROUND_Y = 1000;
export const JUMP_LEVEL_FLOOR = 2;

const singleHopRise = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);

export function maxJumpsForJumpLevel(jumpLevel: number): number {
	switch (jumpLevel) {
		case 3:
			return 4;
		case 2:
			return 2;
		case 1:
			return 1;
		default:
			return 0;
	}
}

/** Conservative stacked-hop rise (each jump from rest at previous apex). */
export function maxVerticalRise(jumpCount: number): number {
	return singleHopRise * jumpCount;
}

export function firstPlatformRise(level: LevelDefinition): number | null {
	const platforms = level.obstacles.filter(
		(o) => o.type === 'platform' && o.y < GROUND_Y,
	);
	if (platforms.length === 0) return null;
	const first = platforms.reduce((a, b) => (a.x < b.x ? a : b));
	return GROUND_Y - first.y;
}

export function openingRouteReachableWithTwoJumps(level: LevelDefinition): boolean {
	const rise = firstPlatformRise(level);
	if (rise === null) return true;
	return rise <= maxVerticalRise(maxJumpsForJumpLevel(JUMP_LEVEL_FLOOR));
}

export function checkAllLevelsOpeningRoutes(): Array<{
	index: number;
	name: string;
	rise: number | null;
	ok: boolean;
}> {
	return LEVELS.map((level, index) => {
		const rise = firstPlatformRise(level);
		const ok = openingRouteReachableWithTwoJumps(level);
		return { index, name: level.name, rise, ok };
	});
}
