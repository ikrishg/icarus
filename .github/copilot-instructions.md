# Icarus - AI Coding Agent Instructions

## Project Overview
Icarus is a **Phaser 3 browser game** built with TypeScript and Bun. Players control Icarus through multi-level platforming challenges with physics-based flight mechanics and a unique ability loss/gain system. The game uses a scene-based architecture with component managers for backgrounds, levels, player controls, and abilities.

## Tech Stack & Build System
- **Runtime**: Bun (not Node.js) - use `bunx --bun` prefix for all Vite commands
- **Game Engine**: Phaser 3 with Arcade physics (gravity: y=800, pixel art mode enabled)
- **Build**: Vite with separate dev/prod configs in `vite/` directory
- **Linting/Formatting**: Biome (tab indentation, single quotes, auto-organize imports)
- **Deployment**: Cloudflare Pages (wrangler) + itch.io (butler) via GitHub Actions

### Key Commands
```bash
bun run dev              # Dev server on port 8080
bun run build            # Production build with terser minification (2 passes)
wrangler pages deploy    # Deploy to Cloudflare Pages
```

## Architecture Patterns

### Scene Flow (src/scenes/)
```
Boot → Home → Menu → Play → Dead/Win
             ↓
        About/Credits
```
- **Boot**: Preloads ALL assets and creates animations before switching to Home
- **Play**: Main game scene - handles collision, death/win, level progression, ability screens
- **Dead/Win**: End-game screens with SPACE to retry, ESC to menu
- Scene navigation: Use `scene.switch()` for state preservation, `scene.start()` for fresh initialization
  - Example: Menu uses `switch()`, Dead/Win use `start('Play')` to reset game state

### Component Architecture

#### Core Managers
1. **AbilityManager** (`src/components/AbilityManager.ts`)
   - Manages 5 player abilities via `PlayerAbilities` type:
     - `jumpLevel` (0-3): Controls max jumps - 3=flight(4 jumps), 2=double, 1=single, 0=none
     - `visionLevel` (0-2): Controls screen darkness overlay alpha (2=clear, 1=dim, 0=blur)
     - `dashLevel` (0-2): Controls move speed - 2=500(dash), 1=350(normal), 0=200(slow)
     - `canMoveLeft` (boolean): Restricts leftward movement when false
     - `canShootArrows` (boolean): Enables/disables arrow shooting
   - Provides helper methods: `getMaxJumps()`, `getMoveSpeed()`, `getVisionAlpha()`, `getAbilityDescription()`
   - Default state: All abilities maxed (gameplay starts with full powers)

2. **LevelManager** (`src/components/LevelManager.ts`)
   - Renders `LevelDefinition[]` from `src/data/levels.ts`
   - Manages 3 physics groups: `platforms` (StaticGroup), `hazards` (Group), `visuals` (Group)
   - Handles dynamic spawning: `fireballs[]` array + `fireballTimers[]` for timed spawns
   - Portal rendered as Container with 192x256 sprite at scale 0.6, plays 'portal-spin' animation
   - Ground tiles rendered using 448px-wide 'ground' sprite repeated across width

3. **Player** (`src/components/Player.ts`)
   - Physics sprite (256x276 base, 0.6 scale = ~154x166 visual)
   - Custom hitbox: 120x140 with offset (68, 63) - smaller than sprite for forgiving gameplay
   - Dual input: Arrow keys OR WASD (both checked in `update()`)
   - Ability integration: Jump count from `abilityManager.getMaxJumps()`, speed from `getMoveSpeed()`
   - Shooting: E key spawns `Arrow` objects with 500ms cooldown (`ARROW_COOLDOWN`)
   - Dashing: Q key triggers dash (1200 velocity, 400ms duration, 1000ms cooldown)
   - `controlsEnabled` flag: Set to false during ability choice screens

4. **Arrow/Fireball** (`src/components/Arrow.ts`, `Fireball.ts`)
   - Projectile classes with physics sprites
   - Arrow: Horizontal movement (800 velocity), destroyed by collision or 3s timeout
   - Fireball: Vertical fall (400 velocity), marked with `sprite.setData('hazard', true)`

### Level Definition System (`src/data/levels.ts`)
Levels are declarative `LevelDefinition` objects:
```typescript
{
  name: string;
  instruction?: string;
  start: Point;       // Player spawn position
  goal: Point;        // Portal position
  obstacles: ObstacleDef[];
  isLoseLevel?: boolean;  // Triggers ability choice screen (player picks 1 to lose)
  isGainLevel?: boolean;  // Restores 3 random abilities
}
```

**Obstacle Types**:
- `platform`: Static rectangular platforms (rendered as tiled 'ground' sprites)
- `spikes`: Repeating spike hazards (`count` determines repetition)
- `lava`: Deadly rectangular zones
- `movingEnemy`: Horizontal patrol enemies (shootable with arrows)
- `fireball`: Timed spawners with `delay` and `interval` properties

### Ability System Integration (Play Scene)
- `completeLevel()` checks `current.isLoseLevel` or `current.isGainLevel` before advancing
- **Lose Screen** (`showAbilityChoiceScreen()`):
  - Displays grid of downgradeable abilities with icons from `public/assets/` (flight.webp, vision.webp, dash.webp, left.webp, bow.webp)
  - Keyboard navigation: Number keys 1-5, Arrow keys, Enter to select
  - Applies changes via `abilityManager.applyChanges()`
- **Gain Screen** (`showAbilityGainScreen()`):
  - Shows 3 random abilities being restored (animated reveal)
  - Auto-advances after 3 seconds

## Asset Management
- All assets in `public/assets/` as WebP (quality 60)
- Convert command: `cwebp -q 60 input.png -o output.webp`
- Spritesheets defined in `Boot.preload()` with exact `frameWidth`/`frameHeight`
- Asset keys: Lowercase, descriptive (e.g., 'icarus', 'portal', 'enemy')
- New assets: Add to Boot preload → Create animations if spritesheet → Reference by key string

## Constants & Configuration
- Canvas: Fixed `1920x1080` (`src/util/constants.ts`)
- Scale mode: `Scale.ScaleModes.FIT` with `NO_CENTER`
- Physics debug: Currently `true` in `src/main.ts` (set `false` for production builds)
- Background: `#1b1b1c` (dark gray)
- Font: Pixelify Sans (loaded via index.html Google Fonts)

## Code Style Conventions
- **Tabs for indentation** (Biome enforced)
- Single quotes for strings
- Explicit types on class properties (especially Phaser objects like `Phaser.Physics.Arcade.Sprite`)
- Component constructors: Scene as first param, then specific args
- Use `readonly` for constants (e.g., `readonly ARROW_COOLDOWN = 500`)
- Import order: Phaser types → local components → data → utils (Biome auto-organizes)

## Collision & Physics Patterns
Setup in `Play.setupCollisions()`:
- **Platforms**: `physics.add.collider(player, levelManager.platforms)`
- **Hazards**: `physics.add.overlap(player, hazard, killPlayer)` for each hazard in group
- **Portal**: `physics.add.overlap(player, portalSprite, completeLevel)` on Container's sprite child
- **Arrows vs Enemies**: Loop-based overlap check (100ms interval) - destroys both on hit
- **Dynamic Fireballs**: Manual overlap check in `Play.update()` loop
- Always check `isResetting` flag before triggering death/completion

## Common Gotchas
- Player death switches to `Dead` scene, which restarts Play from level 0 (not current level)
- Animation keys: Check `this.anims.exists('key')` before creating to avoid duplicates
- Portal collision: Access sprite child from Container via `portal.getAll()` array
- Scene switching: `switch()` preserves scene instance, `start()` reinitializes (use `start()` for Play to reset state)
- Vision overlay: Update alpha in `Play.update()` to reflect ability changes dynamically
- Fireball spawning: Store timer events in `fireballTimers[]` for proper cleanup on level change
- Body offset: Set before `setSize()` on physics bodies - order matters for collision accuracy

## Development Workflow
1. **Local dev**: `bun run dev` → Edit TS files → Vite HMR reloads
2. **New levels**: Add to `LEVELS` array in `src/data/levels.ts` with typed obstacles
3. **New abilities**: Update `PlayerAbilities` type → Modify `AbilityManager` methods → Update UI in `showAbilityChoiceScreen()`
4. **Debug shortcuts** (Play scene):
   - `;` (semicolon): Skip current level
   - `Shift+R`: Restart from level 0 with all abilities reset
   - `ESC`: Return to menu
5. **Deploy**: Push to `main` → GitHub Actions runs release workflow → Deploys to itch.io + creates GitHub release

## CI/CD Pipeline (.github/workflows/release.yaml)
- **Trigger**: Push to `main` branch
- **Changelog Job**: Uses conventional-changelog to generate version tag and changelog, creates PR, auto-merges
- **Release Job**:
  1. Builds with `bun run build` (creates optimized `dist/` folder)
  2. Uploads to itch.io using butler (`kkrishguptaa/icarus:default` channel)
  3. Creates GitHub release with zipped dist
- **Requirements**: `BUTLER_API_KEY` secret for itch.io deployment

## File Organization
```
src/
  index.ts              # Entry point, mounts game to DOM
  main.ts               # Phaser config, scene registration
  scenes/               # 8 scenes: Boot, Home, Menu, Play, About, Credits, Dead, Win
  components/           # Player, LevelManager, AbilityManager, Background, Arrow, Fireball
  data/levels.ts        # LEVELS array (LevelDefinition[])
  util/
    constants.ts        # WIDTH, HEIGHT
    types.ts            # All TypeScript interfaces/types
vite/
  config.dev.mjs        # Dev server (port 8080)
  config.prod.mjs       # Terser minification, manual Phaser chunk
public/assets/          # WebP images and spritesheets
```
