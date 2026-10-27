import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://localhost:4173" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "node test/e2e/server.js",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
})
