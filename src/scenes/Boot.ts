import { Scene } from 'phaser';

export class Boot extends Scene {
	constructor() {
		super('Boot');
	}

	preload() {
		// Boot scene just starts the preloader
		// All assets will be loaded in the Preloader scene
	}

	create() {
		// Start the Preloader scene
		this.scene.start('Preloader');
	}
}
