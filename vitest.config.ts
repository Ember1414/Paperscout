import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // M0-05 起台面：覆盖报告输出到 coverage/，G-04 要求核心纯函数 ≥ 80%
    coverage: {
      reporter: ['text', 'json-summary'],
      include: ['functions/lib/**/*.ts'],
    },
  },
});
