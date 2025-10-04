import { Scene } from 'phaser';

export class Boot extends Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    this.load.image('background', 'assets/sky.webp');
    this.load.image('wordmark', 'assets/wordmark.webp');
    // this.load.image('cloud', 'assets/cloud.webp');
    // this.load.image('arrow', 'assets/arrow.webp');
    this.load.spritesheet('icarus', 'assets/icarus.webp', { frameWidth: 64, frameHeight: 69 });
  }

  create() {
    this.scene.start('Home');
  }
}
