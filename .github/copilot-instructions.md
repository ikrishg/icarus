# Icarus - AI Coding Agent Instructions

## Project Overview
Icarus is a **Phaser 3 browser game** built with TypeScript and Bun. Players control Icarus through multi-level platforming challenges with physics-based flight mechanics. The game uses a scene-based architecture with component managers for backgrounds, levels, and player controls.

## Tech Stack & Build System
- **Runtime**: Bun (not Node.js) - use `bunx --bun` prefix for all Vite commands
- **Game Engine**: Phaser 3 with Arcade physics (gravity: y=800, pixel art mode enabled)
- **Build**: Vite with separate dev/prod configs in `vite/` directory
- **Linting/Formatting**: Biome (tab indentation, single quotes)
- **Deployment**: Cloudflare Pages (via wrangler)

### Key Commands
```bash
bun run dev              # Dev server on port 8080
bun run build            # Production build with terser minification
wrangler pages deploy    # Deploy to Cloudflare (requires CLOUDFLARE_API_TOKEN & CLOUDFLARE_ACCOUNT_ID env vars)
```

## Architecture Patterns

### Scene Flow (src/scenes/)
Game follows Phaser scene lifecycle: `Boot` → `Home` → `Menu` → `Play` (with `About`/`Credits` accessible from Menu)
- **Boot**: Preloads ALL assets (sprites, spritesheets) and creates animations before switching to Home
- **Play**: Main game scene - manages collision setup, player death/reset, level progression
- Scenes use `this.scene.switch()` to navigate (not `start()` - maintains scene state)

### Component Architecture
Three core manager classes handle game logic:

1. **LevelManager** (`src/components/LevelManager.ts`)
   - Renders level data from `src/data/levels.ts` (array of `LevelDefinition` objects)
   - Manages three physics/render groups: `platforms` (StaticGroup), `hazards` (Group), `visuals` (Group)
   - Portal is a Container at goal position - collision with portal triggers `completeLevel()`
   - Level coordinate system uses `cx()/cy()` helpers (percentage-based positioning for 1920x1080 canvas)

2. **Player** (`src/components/Player.ts`)
   - Physics sprite with custom hitbox (120x140) smaller than visual sprite for gameplay feel
   - Double-jump mechanic: `MAX_JUMPS = 2`, resets on `body.touching.down`
   - Dual control schemes: Arrow keys OR WASD (both checked in update loop)
   - Scale: 0.6x of 256x276 base sprite with manual body offset (68, 63) for centering

3. **BackgroundManager** (`src/components/Background.ts`)
   - Creates parallax clouds with random scales/positions
   - Optional animated Icarus sprites in background (opt-in via `{ icarus: false }`)

### Level Definition System (`src/data/levels.ts`)
Levels are declarative objects with typed obstacles:
```typescript
type ObstacleDef =
  | { type: 'platform', x, y, w, h }
  | { type: 'spikes', x, y, count, size }
  | { type: 'lava', x, y, w, h }
  | { type: 'laser', x, y, w, h, delay? }
  | { type: 'movingEnemy', x, y, w, h, range, speed }
```
Each level has `name`, `instruction`, `start` Point, `goal` Point, and `obstacles` array.

## Asset Management
- All assets in `public/assets/` as optimized WebP images
- Use `cwebp -q 60 <file>.png -o <file>.webp` for new assets (see terminal history)
- Spritesheets defined in Boot scene preload with exact frameWidth/frameHeight
- Asset naming: lowercase, descriptive (e.g., `icarus.webp`, `ground.webp`)

## Constants & Configuration
- Canvas size: Fixed `WIDTH = 1920, HEIGHT = 1080` (`src/util/constants.ts`)
- Phaser scale mode: `FIT` with `NO_CENTER` - fits canvas to window while maintaining aspect ratio
- Physics debug mode currently enabled in `src/main.ts` (set `debug: false` for production)
- Background color: `#1b1b1c` (dark gray, not pure black)

## Code Style Conventions
- **Tabs for indentation** (enforced by Biome)
- Single quotes for strings
- Explicit types on class properties, especially for Phaser objects
- Component classes take `Scene` as first constructor param
- Use `readonly` for game constants (e.g., `readonly MOVE_SPEED = 350`)
- Organize imports: Phaser types, local components, data, utils

## Collision & Physics Patterns
In Play scene, collision setup uses `this.physics.add.collider()` and `.overlap()`:
- Player-to-platform: `collider` (solid collision)
- Player-to-hazards: `overlap` with `killPlayer()` callback
- Player-to-portal: `overlap` with `completeLevel()` callback
- Check `this.isResetting` flag before death/completion to prevent duplicate triggers

## Common Gotchas
- Player death resets to **level 0**, not current level (intentional difficulty mechanic)
- Animation keys must be checked with `this.anims.exists()` before creating (Boot scene)
- Portal sprite is 192x256 at scale 0.6, plays 'portal-spin' animation on loop
- ESC key switches to Menu scene from Play (keyboard listener in Play.create())
- Flash camera red (255,0,0) for 300ms on player death for visual feedback

## Development Workflow
1. Edit TypeScript files - Vite HMR handles updates
2. New assets: Convert to WebP → Add to Boot preload → Reference by key
3. New levels: Add to `LEVELS` array in `src/data/levels.ts`
4. Format before commit: Biome auto-formats on save (VS Code integration)
5. Deploy: `wrangler pages deploy` (builds dist/ automatically)

## File Organization
- Entry point: `src/index.ts` → `src/main.ts` (Phaser config)
- Game logic: `src/scenes/` and `src/components/`
- Data/types: `src/data/` and `src/util/`
- Static assets: `public/` (served as-is)
- Build configs: `vite/config.{dev,prod}.mjs`
