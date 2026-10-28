import type { PlayerAbilities } from './types';
import { JUMP_LEVEL_FLOOR, maxJumpsForJumpLevel } from './jumpReach';

export type AbilityKey = keyof PlayerAbilities;

export const ABILITY_MYTH_NAME: Record<AbilityKey, string> = {
	jumpLevel: 'Feathers',
	visionLevel: 'Sight',
	dashLevel: 'Speed',
	canMoveLeft: 'The way home',
	canShootArrows: "Father's bow",
};

export const ABILITY_LOSS_LINE: Record<AbilityKey, string> = {
	jumpLevel: 'The wax softens. Fewer wingbeats.',
	visionLevel: 'The glare grows. The world goes dark.',
	dashLevel: 'Your wings drag. You slow.',
	canMoveLeft: 'You cannot turn back.',
	canShootArrows: 'You let the bow fall.',
};

export function abilityStateLine(
	key: AbilityKey,
	abilities: PlayerAbilities,
): string {
	switch (key) {
		case 'jumpLevel': {
			const j = abilities.jumpLevel;
			const beats = maxJumpsForJumpLevel(j);
			if (j <= JUMP_LEVEL_FLOOR) {
				const label = beats === 1 ? '1 wingbeat' : `${beats} wingbeats`;
				return `${label} (minimum)`;
			}
			const afterBeats = maxJumpsForJumpLevel(
				Math.max(JUMP_LEVEL_FLOOR, j - 1),
			);
			const afterLabel =
				afterBeats === 1 ? '1 wingbeat' : `${afterBeats} wingbeats`;
			return `Feathers: ${beats} -> ${afterLabel}`;
		}
		case 'visionLevel': {
			const v = abilities.visionLevel;
			if (v >= 2) return 'Sight: clear';
			if (v === 1) return 'Sight: dim';
			return 'Sight: near blind';
		}
		case 'dashLevel': {
			const d = abilities.dashLevel;
			if (d >= 2) return 'Speed: dash -> walk';
			if (d === 1) return 'Speed: walk -> slow';
			return 'Speed: slow walk';
		}
		case 'canMoveLeft':
			return abilities.canMoveLeft
				? 'The way home: open'
				: 'The way home: shut';
		case 'canShootArrows':
			return abilities.canShootArrows
				? "Father's bow: in hand"
				: "Father's bow: dropped";
		default:
			return '';
	}
}

const REGAIN_LEVEL_TITLE_BY_INDEX: Record<number, string> = {
	3: 'Daedalus mends you',
	6: 'A cloud passes',
	9: 'The sea wind lifts you',
	12: 'The sun looks away',
};

export function regainLevelTitle(levelIndex: number): string {
	return REGAIN_LEVEL_TITLE_BY_INDEX[levelIndex] ?? 'The sky gives back';
}
