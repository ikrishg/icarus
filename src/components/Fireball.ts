import type { Scene } from 'phaser';

export class Fireball {
  scene: Scene;
  sprite: Phaser.Physics.Arcade.Sprite;
  readonly FALL_SPEED = 400;

  constructor(scene: Scene, x: number, y: number) {
    this.scene = scene;

    // Create fireball sprite
    this.sprite = this.scene.physics.add
      .sprite(x, y, 'fireball')
      .setScale(0.5)
      .setDepth(8);

    // Set physics
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(192, 194);
    body.setAllowGravity(false);
    body.setVelocityY(this.FALL_SPEED);

    // Create animation if it doesn't exist
    if (!this.scene.anims.exists('fireball-fall')) {
      this.scene.anims.create({
        key: 'fireball-fall',
        frames: this.scene.anims.generateFrameNumbers('fireball', {
          start: 0,
          end: 7,
        }),
        frameRate: 12,
        repeat: -1,
      });
    }

    // Play animation
    this.sprite.play('fireball-fall');
    this.sprite.setData('hazard', true);

    // Destroy fireball when it goes off screen
    this.scene.time.addEvent({
      delay: 100,
      callback: () => {
        if (
          this.sprite?.active &&
          this.sprite.y > this.scene.cameras.main.height + 200
        ) {
          this.destroy();
        }
      },
      loop: true,
    });
  }

  destroy() {
    if (this.sprite?.active) {
      this.sprite.destroy();
    }
  }
}
