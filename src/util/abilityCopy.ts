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
			const wingbeats = (level: number) => {
				switch (level) {
					case 3:
						return 4;
					case 2:
						return 2;
					case 1:
						return 1;
					default:
						return 0;
				}
			};
			const current = wingbeats(j);
			const after = wingbeats(Math.max(0, j - 1));
			if (current === 0) return 'Feathers: no wingbeats';
			const label =
				current === 1 ? '1 wingbeat' : `${current} wingbeats`;
			if (after === 0) return `Feathers: ${label} → none`;
			const afterLabel = after === 1 ? '1' : String(after);
			return `Feathers: ${label} → ${afterLabel}`;
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
