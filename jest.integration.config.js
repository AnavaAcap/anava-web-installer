const baseConfig = require('./jest.config.js')

module.exports = {
  ...baseConfig,
  testMatch: [
    '<rootDir>/tests/integration/**/*.test.{js,jsx,ts,tsx}',
  ],
  testTimeout: 30000, // 30 seconds for integration tests
}