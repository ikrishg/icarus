/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_ENABLE_QA_HOOKS?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

interface Window {
	__icarusHoldAbilityCards?: boolean;
	__icarusDeathSpawnXTrack?: {
		active: boolean;
		revived: boolean;
		samples: number[];
	};
	__icarusBeginDeathSpawnXTrack?: () => void;
	__icarusEndDeathSpawnXTrack?: () => number[];
}
