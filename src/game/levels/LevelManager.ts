import type { GameObjects, Scene } from 'phaser';
import { LEVELS } from './levels';
import type { LevelDefinition, ObstacleDef, Point } from './types';

export type { Point, ObstacleDef, LevelDefinition };

export class LevelManager {
  scene: Scene;
  levels: LevelDefinition[];
  currentIndex: number = 0; // index into levels

  // containers for debug visuals
  visuals: GameObjects.Group;
  platforms: Phaser.Physics.Arcade.StaticGroup | undefined;
  hazards: GameObjects.Group; // Group for all deadly obstacles
  portal: Phaser.GameObjects.Container | undefined;

  constructor(scene: Scene, levels: LevelDefinition[] = LEVELS) {
    this.scene = scene;
    this.levels = levels.slice(0, 15); // enforce 15 levels
    this.visuals = this.scene.add.group();
    this.hazards = this.scene.add.group();

    // Create physics group for platforms
    this.platforms = this.scene.physics.add.staticGroup();
  }

  get current(): LevelDefinition {
    return this.levels[this.currentIndex];
  }

  goto(index: number) {
    const clamped = Math.max(0, Math.min(index, this.levels.length - 1));
    this.currentIndex = clamped;
    this.renderCurrent();
  }

  next() {
    if (this.currentIndex < this.levels.length - 1) {
      this.currentIndex += 1;
      this.renderCurrent();
      return true;
    }
    return false;
  }

  restart() {
    this.currentIndex = 0;
    this.renderCurrent();
  }

  renderCurrent() {
    // clear previous visuals
    this.visuals.clear(true, true);
    this.hazards.clear(true, true);

    // Clear and recreate platforms group
    this.platforms?.clear(true, true);
    this.platforms = this.scene.physics.add.staticGroup();

    const level = this.current;

    // Background panel for level title
    const titleBg = this.scene.add
      .rectangle(0, 0, this.scene.cameras.main.width, 50, 0x000000, 0.7)
      .setOrigin(0, 0)
      .setDepth(9);
    this.visuals.add(titleBg);

    // show level name with larger, more prominent text
    const title = this.scene.add
      .text(
        this.scene.cameras.main.width / 2,
        25,
        `Level ${level.id}: ${level.name}`,
        {
          fontFamily: 'Pixelify Sans',
          fontSize: '24px',
          color: '#ffdd00',
          stroke: '#000000',
          strokeThickness: 3,
        },
      )
      .setOrigin(0.5, 0.5)
      .setDepth(10);

    this.visuals.add(title);

    // Create ground platform (2x height)
    const groundY = this.scene.cameras.main.height - 40;
    const ground = this.scene.add.rectangle(
      this.scene.cameras.main.width / 2,
      groundY,
      this.scene.cameras.main.width,
      80,
      0x444444
    );
    ground.setDepth(5);
    this.visuals.add(ground);
    this.platforms?.add(ground);

    // Fix the ground physics body to match visual size
    const groundBody = ground.body as Phaser.Physics.Arcade.StaticBody;
    groundBody.setSize(this.scene.cameras.main.width, 80);
    groundBody.updateFromGameObject();

    // Create portal at goal position
    this.createPortal(level.goal.x, level.goal.y);

    // draw obstacles as simple shapes for now
    level.obstacles.forEach((o) => {
      if (o.type === 'platform') {
        // Create physics-enabled platform
        const platform = this.scene.add.rectangle(
          o.x + o.w / 2,
          o.y + o.h / 2,
          o.w,
          o.h,
          0x666666
        );
        platform.setDepth(5);
        this.visuals.add(platform);

        // Add to physics group
        this.platforms?.add(platform);

        // Fix the physics body to match the visual size exactly
        const body = platform.body as Phaser.Physics.Arcade.StaticBody;
        body.setSize(o.w, o.h);
        body.updateFromGameObject();
      } else if (o.type === 'spikes') {
        for (let i = 0; i < o.count; i++) {
          const sx = o.x + i * o.size;
          const tri = this.scene.add
            .triangle(
              sx + o.size / 2,
              o.y,
              0,
              o.size,
              o.size / 2,
              0,
              o.size,
              o.size,
              0xff2222,
            )
            .setDepth(6);
          tri.setData('hazard', true);
          this.visuals.add(tri);
          this.hazards.add(tri);
        }
      } else if (o.type === 'lava') {
        const l = this.scene.add
          .rectangle(o.x + o.w / 2, o.y + o.h / 2, o.w, o.h, 0xff5500)
          .setDepth(4)
          .setAlpha(0.95);
        l.setData('hazard', true);
        this.visuals.add(l);
        this.hazards.add(l);

        // Add bubbling animation to lava
        this.scene.tweens.add({
          targets: l,
          alpha: { from: 0.85, to: 1 },
          scaleY: { from: 0.98, to: 1.02 },
          duration: 800,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      } else if (o.type === 'laser') {
        const beam = this.scene.add
          .rectangle(o.x + o.w / 2, o.y + o.h / 2, o.w, o.h, 0xff00ff)
          .setDepth(7)
          .setAlpha(0.9);
        beam.setData('hazard', true);
        this.visuals.add(beam);
        this.hazards.add(beam);

        // pulse tween for visual rhythm
        this.scene.tweens.add({
          targets: beam,
          alpha: { from: 0.2, to: 0.95 },
          duration: 600,
          yoyo: true,
          repeat: -1,
          delay: o.delay ?? 0,
        });
      } else if (o.type === 'movingEnemy') {
        const enemy = this.scene.add
          .rectangle(o.x, o.y, o.w, o.h, 0xff88ff)
          .setDepth(8);
        enemy.setData('hazard', true);
        this.visuals.add(enemy);
        this.hazards.add(enemy);

        // simple horizontal patrol tween
        this.scene.tweens.add({
          targets: enemy,
          x: { from: o.x - o.range / 2, to: o.x + o.range / 2 },
          duration: Math.max(200, Math.floor((o.range / o.speed) * 1000)),
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: -1,
        });
      }
    });
  }

  createPortal(x: number, y: number) {
    // Create portal container (2x size)
    this.portal = this.scene.add.container(x, y).setDepth(9);

    const PORTAL_SCALE = 2; // 2x larger

    // Outer ring
    const outerRing = this.scene.add.circle(0, 0, 60 * PORTAL_SCALE, 0x00ffaa, 0).setStrokeStyle(6 * PORTAL_SCALE, 0x00ffaa, 0.8);
    // Middle ring
    const middleRing = this.scene.add.circle(0, 0, 45 * PORTAL_SCALE, 0x00ff88, 0).setStrokeStyle(4 * PORTAL_SCALE, 0x00ff88, 0.9);
    // Inner glow
    const innerGlow = this.scene.add.circle(0, 0, 35 * PORTAL_SCALE, 0x00ffff, 0.3);
    // Center star
    const star = this.scene.add.star(0, 0, 8, 15 * PORTAL_SCALE, 25 * PORTAL_SCALE, 0xffffff, 0.9);

    this.portal.add([outerRing, middleRing, innerGlow, star]);
    this.visuals.add(this.portal);

    // Rotate outer ring
    this.scene.tweens.add({
      targets: outerRing,
      angle: 360,
      duration: 3000,
      repeat: -1,
      ease: 'Linear',
    });

    // Counter-rotate middle ring
    this.scene.tweens.add({
      targets: middleRing,
      angle: -360,
      duration: 2000,
      repeat: -1,
      ease: 'Linear',
    });

    // Pulse inner glow
    this.scene.tweens.add({
      targets: innerGlow,
      alpha: { from: 0.2, to: 0.6 },
      scale: { from: 0.9, to: 1.1 },
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Rotate star
    this.scene.tweens.add({
      targets: star,
      angle: 360,
      duration: 4000,
      repeat: -1,
      ease: 'Linear',
    });
  }
}

export default LevelManager;
