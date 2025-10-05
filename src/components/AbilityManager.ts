import type { PlayerAbilities } from '../util/types';

export class AbilityManager {
	abilities: PlayerAbilities;

	constructor() {
		// Start with all abilities at max level
		this.abilities = {
			jumpLevel: 3, // Flight (4 jumps)
			visionLevel: 2, // Perfect vision
			dashLevel: 2, // Can dash
			canMoveLeft: true,
			canShootArrows: true,
		};
	}

	// Get max jumps based on jump level
	getMaxJumps(): number {
		switch (this.abilities.jumpLevel) {
			case 3:
				return 4; // Flight
			case 2:
				return 2; // Double jump
			case 1:
				return 1; // Single jump
			default:
				return 0; // No jump
		}
	}

	// Get move speed based on dash level
	getMoveSpeed(): number {
		switch (this.abilities.dashLevel) {
			case 2:
				return 500; // Dash speed
			case 1:
				return 350; // Normal speed
			default:
				return 200; // Slow walk
		}
	}

	// Get vision effect (returns alpha value for overlay)
	getVisionAlpha(): number {
		switch (this.abilities.visionLevel) {
			case 2:
				return 0; // Perfect vision - no overlay
			case 1:
				return 0.3; // Dim vision
			default:
				return 0.6; // Blur vision
		}
	}

	// Get dash ability
	canDash(): boolean {
		return this.abilities.dashLevel === 2;
	}

	// Apply ability changes
	applyChanges(changes: Partial<PlayerAbilities>) {
		this.abilities = { ...this.abilities, ...changes };
	}

	// Reset to default (all abilities)
	reset() {
		this.abilities = {
			jumpLevel: 3,
			visionLevel: 2,
			dashLevel: 2,
			canMoveLeft: true,
			canShootArrows: true,
		};
	}

	// Get ability description
	getAbilityDescription(abilityKey: keyof PlayerAbilities): string {
		switch (abilityKey) {
			case 'jumpLevel':
				switch (this.abilities.jumpLevel) {
					case 3:
						return 'Flight (4 jumps)';
					case 2:
						return 'Double Jump';
					case 1:
						return 'Single Jump';
					default:
						return 'No Jump';
				}
			case 'visionLevel':
				switch (this.abilities.visionLevel) {
					case 2:
						return 'Perfect Vision';
					case 1:
						return 'Dim Vision';
					default:
						return 'Blur Vision';
				}
			case 'dashLevel':
				switch (this.abilities.dashLevel) {
					case 2:
						return 'Dash';
					case 1:
						return 'Normal Speed';
					default:
						return 'Slow Walk';
				}
			case 'canMoveLeft':
				return this.abilities.canMoveLeft
					? 'Can Move Left'
					: 'Cannot Move Left';
			case 'canShootArrows':
				return this.abilities.canShootArrows ? 'Can Shoot Arrows' : 'No Arrows';
			default:
				return 'Unknown';
		}
	}
}
