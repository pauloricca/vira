import { defineConfig } from 'vitest/config';
import { teiaInputsPlugin } from './teia-inputs-plugin';
export default defineConfig({ plugins: [teiaInputsPlugin()], test: { include: ['frontend/**/*.test.{ts,tsx}'] } });
