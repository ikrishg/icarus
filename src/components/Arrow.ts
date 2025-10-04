import type { Scene } from 'phaser';

export class Arrow {
  scene: Scene;
  sprite: Phaser.Physics.Arcade.Sprite;
  readonly ARROW_SPEED = 800;

  constructor(scene: Scene, x: number, y: number, direction: number) {
    this.scene = scene;

    // Create arrow sprite
    this.sprite = this.scene.physics.add
      .sprite(x, y, 'arrow')
      .setScale(0.4)
      .setDepth(9);

    // Set arrow direction (1 for right, -1 for left)
    this.sprite.setFlipX(direction < 0);
    this.sprite.setVelocityX(this.ARROW_SPEED * direction);

    // Set physics body
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(224, 114);
    body.setAllowGravity(false);

    // Destroy arrow after 3 seconds
    this.scene.time.delayedCall(3000, () => {
      this.destroy();
    });
  }

  destroy() {
    if (this.sprite?.active) {
      this.sprite.destroy();
    }
  }
}
