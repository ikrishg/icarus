import type { Scene } from 'phaser';

export class Player {
  scene: Scene;
  sprite: Phaser.Physics.Arcade.Sprite;
  cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined;
  wasd: {
    up: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  } | undefined;

  // Movement constants
  readonly MOVE_SPEED = 350;
  readonly JUMP_VELOCITY = -550;
  readonly MAX_JUMPS = 2; // double jump

  jumpCount = 0;
  isDead = false;

  constructor(scene: Scene, x: number, y: number) {
    this.scene = scene;

    // Create player sprite using Icarus spritesheet (2x size)
    // Original sprite is 256x276, with 2x scale at 0.6 = ~154x166 pixels
    this.sprite = this.scene.physics.add
      .sprite(x, y, 'icarus')
      .setScale(0.6) // 2x scale for consistency
      .setDepth(10);

    // Play the flying animation
    this.sprite.play('player-fly');

    // Set collision properties
    this.sprite.setBounce(0.1);
    this.sprite.setCollideWorldBounds(true);

    // Set body size for better collision detection
    // Scaled sprite is ~154x166 pixels
    // Make hitbox slightly smaller for better gameplay (~80% of visual size)
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(120, 140); // Proper 2x hitbox
    body.setOffset(68, 63); // Center the hitbox on the sprite

    // Setup keyboard controls
    this.cursors = this.scene.input.keyboard?.createCursorKeys();

    if (this.scene.input.keyboard) {
      this.wasd = {
        up: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        left: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        down: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        right: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
    }
  }

  update() {
    if (!this.sprite.body || this.isDead) return;

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;

    // Reset jump count when touching ground
    if (body.touching.down) {
      this.jumpCount = 0;
    }

    // Horizontal movement
    if (this.cursors?.left.isDown || this.wasd?.left.isDown) {
      this.sprite.setVelocityX(-this.MOVE_SPEED);
      this.sprite.setFlipX(true); // Flip sprite to face left
    } else if (this.cursors?.right.isDown || this.wasd?.right.isDown) {
      this.sprite.setVelocityX(this.MOVE_SPEED);
      this.sprite.setFlipX(false); // Face right
    } else {
      this.sprite.setVelocityX(0);
    }

    // Jumping (with double jump)
    if (
      Phaser.Input.Keyboard.JustDown(this.cursors?.up as Phaser.Input.Keyboard.Key) ||
      Phaser.Input.Keyboard.JustDown(this.wasd?.up as Phaser.Input.Keyboard.Key) ||
      Phaser.Input.Keyboard.JustDown(this.cursors?.space as Phaser.Input.Keyboard.Key)
    ) {
      if (this.jumpCount < this.MAX_JUMPS) {
        this.sprite.setVelocityY(this.JUMP_VELOCITY);
        this.jumpCount++;
      }
    }

    // Slight rotation based on vertical velocity for better feel
    const rotation = Phaser.Math.Clamp(body.velocity.y * 0.0003, -0.2, 0.2);
    this.sprite.setRotation(rotation);
  }

  die() {
    if (this.isDead) return;

    this.isDead = true;
    this.sprite.setTint(0xff0000); // Red tint on death
    this.sprite.setVelocity(0, -300); // Pop up slightly
    this.sprite.setAngularVelocity(500); // Spin

    // Stop animation
    this.sprite.stop();
  }

  revive(x: number, y: number) {
    this.isDead = false;
    this.sprite.clearTint();
    this.sprite.setRotation(0);
    this.sprite.setAngularVelocity(0);
    this.sprite.play('player-fly');
    this.setPosition(x, y);
  }

  setPosition(x: number, y: number) {
    this.sprite.setPosition(x, y);
    this.sprite.setVelocity(0, 0);
    this.jumpCount = 0;
  }

  destroy() {
    this.sprite.destroy();
  }
}
