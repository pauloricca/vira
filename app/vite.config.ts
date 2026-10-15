import { defineConfig } from 'vite';
import { teiaInputsPlugin } from './teia-inputs-plugin';
export default defineConfig({ plugins: [teiaInputsPlugin()], build: { rollupOptions: { input: { main: 'index.html', teia: 'teia-editor.html' } } } });
