/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_ENABLE_QA_HOOKS?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

interface Window {
	__icarusHoldAbilityCards?: boolean;
}
