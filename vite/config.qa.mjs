import { defineConfig } from 'vite';

export default defineConfig({
	base: './',
	define: {
		'import.meta.env.VITE_ENABLE_QA_HOOKS': JSON.stringify('true'),
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks: {
					phaser: ['phaser'],
				},
			},
		},
	},
});
