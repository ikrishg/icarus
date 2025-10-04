import { Scene } from 'phaser';

export class Boot extends Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    this.load.image('background', 'assets/sky.webp');
    this.load.image('wordmark', 'assets/wordmark.webp');
    this.load.image('cloud', 'assets/cloud.webp');
    this.load.image('arrow', 'assets/sword.webp');
    this.load.spritesheet('icarus', 'assets/icarus.webp', {
      frameWidth: 256,
      frameHeight: 276,
    });
  }

  create() {
    // Create Icarus flying animation for player
    if (!this.anims.exists('player-fly')) {
      this.anims.create({
        key: 'player-fly',
        frames: this.anims.generateFrameNumbers('icarus', {
          start: 0,
          end: 15,
        }),
        frameRate: 12,
        repeat: -1,
      });
    }

    this.scene.switch('Home');
  }
}
