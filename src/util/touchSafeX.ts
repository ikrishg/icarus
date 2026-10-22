import type { LevelDefinition, ObstacleDef } from './types';

/** Minimum gap between player sprite bounds and nearest static hazard edge. */
export const TOUCH_HAZARD_MARGIN_PX = 96;

const SPIKE_FRAME_W = 402;
const FIREBALL_HALF_W = 27;

export type AxisInterval = { left: number; right: number };

export function spikeSegmentIntervals(obstacle: ObstacleDef): AxisInterval[] {
	if (obstacle.type !== 'spikes') return [];
	const scale = obstacle.size / 129;
	const w = SPIKE_FRAME_W * scale;
	const out: AxisInterval[] = [];
	for (let i = 0; i < obstacle.count; i++) {
		const left = obstacle.x + i * w;
		out.push({ left, right: left + w });
	}
	return out;
}

export function hazardIntervalsForLevel(
	level: LevelDefinition,
	spawnY: number,
): AxisInterval[] {
	const intervals: AxisInterval[] = [];
	for (const o of level.obstacles ?? []) {
		if (o.type === 'spikes') {
			intervals.push(...spikeSegmentIntervals(o));
		}
		if (o.type === 'fireball' && spawnY <= o.y + 120) {
			intervals.push({
				left: o.x - FIREBALL_HALF_W,
				right: o.x + FIREBALL_HALF_W,
			});
		}
	}
	return intervals;
}

export function spriteHorizontalBoundsAt(
	centerX: number,
	spriteHalfW: number,
): AxisInterval {
	return { left: centerX - spriteHalfW, right: centerX + spriteHalfW };
}

/** Distance from sprite bounds to nearest hazard interval (0 if overlapping). */
export function clearanceToHazards(
	bounds: AxisInterval,
	hazards: AxisInterval[],
): number {
	let best = Infinity;
	for (const h of hazards) {
		if (bounds.right <= h.left) {
			best = Math.min(best, h.left - bounds.right);
		} else if (bounds.left >= h.right) {
			best = Math.min(best, bounds.left - h.right);
		} else {
			return 0;
		}
	}
	return best === Infinity ? Infinity : best;
}

export function touchSpawnHazardClearAt(
	centerX: number,
	spriteHalfW: number,
	level: LevelDefinition,
	spawnY: number,
	margin = TOUCH_HAZARD_MARGIN_PX,
): boolean {
	const bounds = spriteHorizontalBoundsAt(centerX, spriteHalfW);
	const hazards = hazardIntervalsForLevel(level, spawnY);
	const gap = clearanceToHazards(bounds, hazards);
	return gap >= margin;
}

export type ButtonRect = {
	left: number;
	right: number;
	top: number;
	bottom: number;
};

export function spriteOverlapsButtons(
	centerX: number,
	spawnY: number,
	spriteHalfW: number,
	spriteHalfH: number,
	buttons: ButtonRect[],
): boolean {
	const playerRect = {
		left: centerX - spriteHalfW,
		right: centerX + spriteHalfW,
		top: spawnY - spriteHalfH,
		bottom: spawnY + spriteHalfH,
	};
	return buttons.some(
		(b) =>
			playerRect.left < b.right - 0.5 &&
			playerRect.right > b.left + 0.5 &&
			playerRect.top < b.bottom &&
			playerRect.bottom > b.top,
	);
}

export type FindSafeTouchXOptions = {
	startX: number;
	clusterMinX: number;
	maxX: number;
	spawnY: number;
	spriteHalfW: number;
	spriteHalfH: number;
	level: LevelDefinition;
	buttons: ButtonRect[];
	ledgeBlocked: (centerX: number) => boolean;
	step?: number;
};

/** Hazard-first: nearest safe x ≥ clusterMin that clears hazards, ledges, and buttons. */
export function findSafeTouchCenterX(
	options: FindSafeTouchXOptions,
): number | null {
	const {
		startX,
		clusterMinX,
		maxX,
		spawnY,
		spriteHalfW,
		spriteHalfH,
		level,
		buttons,
		ledgeBlocked,
		step = 8,
	} = options;
	const from = Math.max(startX, clusterMinX);
	for (let tx = from; tx <= maxX; tx += step) {
		if (ledgeBlocked(tx)) continue;
		if (!touchSpawnHazardClearAt(tx, spriteHalfW, level, spawnY)) continue;
		if (
			spriteOverlapsButtons(
				tx,
				spawnY,
				spriteHalfW,
				spriteHalfH,
				buttons,
			)
		) {
			continue;
		}
		return tx;
	}
	for (let tx = from; tx <= maxX; tx += step) {
		if (ledgeBlocked(tx)) continue;
		if (!touchSpawnHazardClearAt(tx, spriteHalfW, level, spawnY)) continue;
		return tx;
	}
	return null;
}
