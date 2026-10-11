import type { PlayerAbilities } from './types';

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
			if (j >= 3) return 'Feathers: 4 wingbeats';
			if (j === 2) return 'Feathers: 4 wingbeats to 2';
			if (j === 1) return 'Feathers: 2 wingbeats to 1';
			return 'Feathers: no wingbeats';
		}
		case 'visionLevel': {
			const v = abilities.visionLevel;
			if (v >= 2) return 'Sight: clear';
			if (v === 1) return 'Sight: dim';
			return 'Sight: near blind';
		}
		case 'dashLevel': {
			const d = abilities.dashLevel;
			if (d >= 2) return 'Speed: dash';
			if (d === 1) return 'Speed: dash to walk';
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
