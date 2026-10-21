import type { Scene } from 'phaser';
import { HEIGHT, WIDTH } from '../util/constants';
import { PALETTE, PALETTE_HEX } from '../util/palette';
import {
	gameFontForMinScreenPx,
	MIN_TOUCH_SCREEN_TEXT_PX,
} from '../util/responsiveText';
import { touchChromeMetrics } from '../util/touchLayout';

const CHROME_DEPTH = 300;

export type TouchInputState = {
	left: boolean;
	right: boolean;
	jump: boolean;
	shoot: boolean;
	dash: boolean;
	jumpJustDown: boolean;
	shootJustDown: boolean;
	dashJustDown: boolean;
};

export function isTouchDevice(scene?: Scene): boolean {
	if (scene?.sys.game.device.input.touch) {
		return true;
	}
	if (typeof window === 'undefined') return false;
	return (
		'ontouchstart' in window ||
		navigator.maxTouchPoints > 0 ||
		window.matchMedia('(pointer: coarse)').matches
	);
}

const MIN_TOUCH_CSS_PX = 44;
const BASE_BTN_GAME_PX = 88;
const BASE_MARGIN_GAME_PX = 24;
/** Modest gap past the ◀▶ cluster; spawn may overlap translucent buttons. */
const PLAYER_SPAWN_PAD = 12;

type HoldRole = 'left' | 'right' | 'jump' | 'dash' | 'shoot';

export class TouchControls {
	private scene: Scene;
	private gameplayNodes: Phaser.GameObjects.GameObject[] = [];
	private leftMovementNodes: Phaser.GameObjects.GameObject[] = [];
	private chromeNodes: Phaser.GameObjects.GameObject[] = [];
	private state: TouchInputState = {
		left: false,
		right: false,
		jump: false,
		shoot: false,
		dash: false,
		jumpJustDown: false,
		shootJustDown: false,
		dashJustDown: false,
	};
	private prevJump = false;
	private prevShoot = false;
	private prevDash = false;
	private controlsShown = true;
	visible = false;
	readonly tapTargets: {
		left?: { x: number; y: number };
		right?: { x: number; y: number };
		jump?: { x: number; y: number };
	} = {};
	private onPause?: () => void;
	private readonly activeHolds = new Map<number, HoldRole>();
	private readonly buttonHitAreas = new Map<HoldRole, Phaser.GameObjects.Rectangle>();
	private readonly pointerReleaseHandlers: Array<{
		pointerId: number | null;
		role: HoldRole;
		release: () => void;
	}> = [];
	private readonly onGlobalPointerRelease = (
		pointer: Phaser.Input.Pointer,
	) => {
		for (const entry of this.pointerReleaseHandlers) {
			if (entry.pointerId === pointer.id) {
				entry.pointerId = null;
				entry.release();
			}
		}
		this.activeHolds.delete(pointer.id);
	};

	private readonly onGlobalPointerMove = (pointer: Phaser.Input.Pointer) => {
		if (!pointer.isDown) return;
		for (const entry of this.pointerReleaseHandlers) {
			if (entry.pointerId !== pointer.id) continue;
			if (!this.pointerHitsRole(pointer, entry.role)) {
				entry.pointerId = null;
				entry.release();
				this.activeHolds.delete(pointer.id);
			}
		}
	};

	constructor(scene: Scene) {
		this.scene = scene;
		if (!isTouchDevice(scene)) {
			return;
		}
		this.visible = true;
		this.scene.input.on('pointerup', this.onGlobalPointerRelease);
		this.scene.input.on('pointercancel', this.onGlobalPointerRelease);
		this.scene.input.on('pointermove', this.onGlobalPointerMove);
		this.build();
	}

	setTopBarHandlers(onPause: () => void, _onRestart: () => void): void {
		this.onPause = onPause;
	}

	private setRoleDown(role: HoldRole, down: boolean): void {
		switch (role) {
			case 'left':
				this.state.left = down;
				break;
			case 'right':
				this.state.right = down;
				break;
			case 'jump':
				this.state.jump = down;
				break;
			case 'dash':
				this.state.dash = down;
				break;
			case 'shoot':
				this.state.shoot = down;
				break;
		}
	}

	private pointerHitsRole(
		pointer: Phaser.Input.Pointer,
		role: HoldRole,
	): boolean {
		const area = this.buttonHitAreas.get(role);
		if (!area?.active) return false;
		const b = area.getBounds();
		return (
			pointer.x >= b.left &&
			pointer.x <= b.right &&
			pointer.y >= b.top &&
			pointer.y <= b.bottom
		);
	}

	/** Minimum player center X clearing only the left movement cluster (◀ ▶). */
	getMinSpawnX(bodyHalfWidth = 0): number {
		if (!this.visible) return 0;
		const { size, margin, gap } = this.layoutMetrics();
		const leftX = margin + size / 2;
		const rightX = leftX + size + gap;
		const clusterRight = rightX + size / 2;
		return clusterRight + PLAYER_SPAWN_PAD + bodyHalfWidth;
	}

	getLeftMovementButtonBounds(): Array<{
		left: number;
		right: number;
		top: number;
		bottom: number;
	}> {
		const out: Array<{
			left: number;
			right: number;
			top: number;
			bottom: number;
		}> = [];
		for (const node of this.leftMovementNodes) {
			if (!node.active || !('getBounds' in node)) continue;
			const b = (
				node as Phaser.GameObjects.GameObject & {
					getBounds: () => Phaser.Geom.Rectangle;
				}
			).getBounds();
			out.push({
				left: b.left,
				right: b.right,
				top: b.top,
				bottom: b.bottom,
			});
		}
		return out;
	}

	getGameplayButtonBounds(): Array<{
		left: number;
		right: number;
		top: number;
		bottom: number;
	}> {
		const out: Array<{
			left: number;
			right: number;
			top: number;
			bottom: number;
		}> = [];
		for (const node of this.gameplayNodes) {
			if (!node.active || !('getBounds' in node)) continue;
			const b = (
				node as Phaser.GameObjects.GameObject & {
					getBounds: () => Phaser.Geom.Rectangle;
				}
			).getBounds();
			out.push({
				left: b.left,
				right: b.right,
				top: b.top,
				bottom: b.bottom,
			});
		}
		return out;
	}

	relayout(): void {
		if (!this.visible) return;
		const show = this.controlsShown;
		const heldPointers = this.scene.input.manager.pointers
			.filter((p) => p.isDown)
			.map((p) => ({ id: p.id, pointer: p, role: this.activeHolds.get(p.id) }));

		this.pointerReleaseHandlers.length = 0;
		this.buttonHitAreas.clear();
		for (const node of [...this.gameplayNodes, ...this.chromeNodes]) {
			node.destroy();
		}
		this.gameplayNodes = [];
		this.leftMovementNodes = [];
		this.chromeNodes = [];
		this.tapTargets.left = undefined;
		this.tapTargets.right = undefined;
		this.tapTargets.jump = undefined;

		this.state.left = false;
		this.state.right = false;
		this.state.jump = false;
		this.state.shoot = false;
		this.state.dash = false;
		this.activeHolds.clear();

		this.build();
		this.applyControlsVisible(show);

		for (const { id, pointer, role } of heldPointers) {
			if (!role) continue;
			if (this.pointerHitsRole(pointer, role)) {
				this.activeHolds.set(id, role);
				this.setRoleDown(role, true);
				const slot = this.pointerReleaseHandlers.find((h) => h.role === role);
				if (slot) slot.pointerId = id;
			}
		}
	}

	private layoutMetrics() {
		const displayScale = Math.max(
			this.scene.scale.displaySize.width / WIDTH,
			this.scene.scale.displaySize.height / HEIGHT,
		);
		const size = Math.min(
			96,
			Math.max(
				BASE_BTN_GAME_PX,
				Math.ceil(MIN_TOUCH_CSS_PX / displayScale),
			),
		);
		const margin = Math.max(
			BASE_MARGIN_GAME_PX,
			Math.ceil(16 / displayScale),
		);
		const gap = Math.max(16, Math.ceil(12 / displayScale));
		return { size, margin, gap };
	}

	private makeButton(
		x: number,
		y: number,
		size: number,
		label: string,
		role: HoldRole,
		onDown: () => void,
		onUp: () => void,
		options?: { leftCluster?: boolean; chrome?: boolean },
	): void {
		const chrome = options?.chrome ?? false;
		const bg = this.scene.add
			.rectangle(x, y, size, size, 0xffffff, 0.45)
			.setStrokeStyle(4, 0x1b1b1c, 0.9)
			.setScrollFactor(0)
			.setDepth(201)
			.setInteractive({ useHandCursor: false });
		this.buttonHitAreas.set(role, bg);

		const fontSize = Math.max(36, Math.floor(size * 0.32));
		const text = this.scene.add
			.text(x, y, label, {
				fontFamily: 'Pixelify Sans',
				fontSize: `${fontSize}px`,
				color: '#1b1b1c',
				align: 'center',
			})
			.setOrigin(0.5)
			.setScrollFactor(0)
			.setDepth(202);

		const pointerSlot = {
			pointerId: null as number | null,
			role,
			release: onUp,
		};
		this.pointerReleaseHandlers.push(pointerSlot);
		const releaseIfOwner = (pointer: Phaser.Input.Pointer) => {
			if (pointerSlot.pointerId !== pointer.id) return;
			pointerSlot.pointerId = null;
			this.activeHolds.delete(pointer.id);
			onUp();
		};
		bg.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
			pointer.event?.preventDefault();
			pointerSlot.pointerId = pointer.id;
			this.activeHolds.set(pointer.id, role);
			onDown();
		});
		bg.on('pointerup', releaseIfOwner);
		bg.on('pointercancel', releaseIfOwner);

		const bucket = chrome ? this.chromeNodes : this.gameplayNodes;
		bucket.push(bg, text);
		if (options?.leftCluster) {
			this.leftMovementNodes.push(bg);
		}
	}

	private makeChromeButton(
		centerX: number,
		centerY: number,
		width: number,
		height: number,
		label: string,
		onTap: () => void,
	): void {
		const bg = this.scene.add
			.rectangle(centerX, centerY, width, height, PALETTE.deep, 0.92)
			.setStrokeStyle(2, PALETTE.cloudWhite, 0.35)
			.setScrollFactor(0)
			.setDepth(CHROME_DEPTH)
			.setInteractive({ useHandCursor: true });
		const fontPx = Math.max(
			28,
			gameFontForMinScreenPx(this.scene, MIN_TOUCH_SCREEN_TEXT_PX),
		);
		const text = this.scene.add
			.text(centerX, centerY, label, {
				fontFamily: 'Pixelify Sans',
				fontSize: `${fontPx}px`,
				color: PALETTE_HEX.cloudWhite,
				align: 'center',
			})
			.setOrigin(0.5)
			.setScrollFactor(0)
			.setDepth(CHROME_DEPTH + 1);
		const tap = (pointer: Phaser.Input.Pointer) => {
			pointer.event?.preventDefault();
			onTap();
		};
		bg.on('pointerdown', tap);
		text.setInteractive({ useHandCursor: true });
		text.on('pointerdown', tap);
		this.chromeNodes.push(bg, text);
	}

	getChromeBounds(): Array<{
		left: number;
		right: number;
		top: number;
		bottom: number;
	}> {
		const out: Array<{
			left: number;
			right: number;
			top: number;
			bottom: number;
		}> = [];
		for (const node of this.chromeNodes) {
			if (!node.active || !('getBounds' in node)) continue;
			const b = (
				node as Phaser.GameObjects.GameObject & {
					getBounds: () => Phaser.Geom.Rectangle;
				}
			).getBounds();
			out.push({
				left: b.left,
				right: b.right,
				top: b.top,
				bottom: b.bottom,
			});
		}
		return out;
	}

	private build() {
		const { size, margin, gap } = this.layoutMetrics();
		const baseY = HEIGHT - margin - size / 2;
		const leftX = margin + size / 2;
		const rightX = leftX + size + gap;

		this.tapTargets.left = { x: leftX, y: baseY };
		this.makeButton(
			leftX,
			baseY,
			size,
			'◀',
			'left',
			() => {
				this.state.left = true;
			},
			() => {
				this.state.left = false;
			},
			{ leftCluster: true },
		);

		this.tapTargets.right = { x: rightX, y: baseY };
		this.makeButton(
			rightX,
			baseY,
			size,
			'▶',
			'right',
			() => {
				this.state.right = true;
			},
			() => {
				this.state.right = false;
			},
			{ leftCluster: true },
		);

		const rightCol = WIDTH - margin - size / 2;
		const leftCol = rightCol - size - gap;
		const topRowY = baseY - size - gap;

		this.tapTargets.jump = { x: leftCol, y: topRowY };
		this.makeButton(
			leftCol,
			topRowY,
			size,
			'↑',
			'jump',
			() => {
				this.state.jump = true;
			},
			() => {
				this.state.jump = false;
			},
		);

		this.makeButton(
			rightCol,
			topRowY,
			size,
			'Q',
			'dash',
			() => {
				this.state.dash = true;
			},
			() => {
				this.state.dash = false;
			},
		);

		this.makeButton(
			rightCol,
			baseY,
			size,
			'E',
			'shoot',
			() => {
				this.state.shoot = true;
			},
			() => {
				this.state.shoot = false;
			},
		);

		const chrome = touchChromeMetrics(this.scene);
		this.makeChromeButton(
			chrome.pauseCenterX,
			chrome.pauseCenterY,
			chrome.chromeW,
			chrome.chromeH,
			'Pause',
			() => {
				this.onPause?.();
			},
		);
		this.applyControlsVisible(this.controlsShown);
	}

	beginFrame() {
		this.state.jumpJustDown = this.state.jump && !this.prevJump;
		this.state.shootJustDown = this.state.shoot && !this.prevShoot;
		this.state.dashJustDown = this.state.dash && !this.prevDash;
		this.prevJump = this.state.jump;
		this.prevShoot = this.state.shoot;
		this.prevDash = this.state.dash;
	}

	getInput(): TouchInputState {
		return this.state;
	}

	setTouchState(
		partial: Partial<
			Pick<TouchInputState, 'left' | 'right' | 'jump' | 'shoot' | 'dash'>
		>,
	) {
		Object.assign(this.state, partial);
	}

	private applyControlsVisible(visible: boolean) {
		if (!this.visible) return;
		const nodes = [...this.gameplayNodes, ...this.chromeNodes];
		for (const node of nodes) {
			if ('setVisible' in node && typeof node.setVisible === 'function') {
				node.setVisible(visible);
			}
		}
	}

	setGameplayVisible(visible: boolean) {
		if (!this.visible) return;
		this.controlsShown = visible;
		this.applyControlsVisible(visible);
	}

	destroy() {
		this.scene.input.off('pointerup', this.onGlobalPointerRelease);
		this.scene.input.off('pointercancel', this.onGlobalPointerRelease);
		this.scene.input.off('pointermove', this.onGlobalPointerMove);
		for (const node of [...this.gameplayNodes, ...this.chromeNodes]) {
			node.destroy();
		}
		this.gameplayNodes = [];
		this.leftMovementNodes = [];
		this.chromeNodes = [];
	}
}
