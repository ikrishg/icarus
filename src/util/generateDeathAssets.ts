import type { Scene } from 'phaser';

/** Placeholder death animations from `icarus.webp` until final Sprite sheets ship. */
export function registerDeathPlaceholderTextures(scene: Scene): void {
	if (!scene.textures.exists('death-fx')) {
		const g = scene.make.graphics({ x: 0, y: 0 }, false);
		g.fillStyle(0xfdfdfe, 1);
		g.fillRect(1, 3, 6, 2);
		g.fillStyle(0x442d32, 1);
		g.fillRect(0, 1, 1, 5);
		g.generateTexture('death-fx', 8, 8);
		g.destroy();
	}

	if (!scene.textures.exists('sea-splash')) {
		const g = scene.make.graphics({ x: 0, y: 0 }, false);
		g.fillStyle(0x8fd4fe, 1);
		g.fillRect(6, 18, 20, 6);
		g.fillStyle(0xfdfdfe, 1);
		g.fillRect(8, 14, 16, 4);
		g.generateTexture('sea-splash', 32, 32);
		g.destroy();
	}

	if (!scene.textures.exists('sea-ripple')) {
		const g = scene.make.graphics({ x: 0, y: 0 }, false);
		g.fillStyle(0x48a9fe, 1);
		g.fillEllipse(16, 4, 22, 4);
		g.generateTexture('sea-ripple', 32, 8);
		g.destroy();
	}
}

export function registerDeathAnimations(scene: Scene): void {
	if (!scene.textures.exists('icarus')) return;
	const anims = scene.anims;

	if (!anims.exists('icarus-melt')) {
		anims.create({
			key: 'icarus-melt',
			frames: anims.generateFrameNumbers('icarus', { start: 10, end: 13 }),
			frameRate: 14,
			repeat: 0,
		});
	}
	if (!anims.exists('icarus-fall')) {
		anims.create({
			key: 'icarus-fall',
			frames: anims.generateFrameNumbers('icarus', { start: 10, end: 11 }),
			frameRate: 8,
			repeat: -1,
		});
	}
	if (!anims.exists('icarus-rise')) {
		anims.create({
			key: 'icarus-rise',
			frames: anims.generateFrameNumbers('icarus', { start: 0, end: 2 }),
			frameRate: 12,
			repeat: 0,
		});
	}
}
