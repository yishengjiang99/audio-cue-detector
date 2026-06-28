const { test, expect } = require("@playwright/test");
const path = require("path");

const mediaMockPath = path.join(__dirname, "../helpers/media-mock.js");
const testCuePath = path.join(__dirname, "../fixtures/test-cue.wav");

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: mediaMockPath });
  await page.goto("/");
});

test("page loads with title and NEUTRAL decision", async ({ page }) => {
  await expect(page).toHaveTitle("Solo Shuffle Audio Coach");
  await expect(page.locator("h1")).toHaveText("Solo Shuffle Audio Coach");
  await expect(page.locator("#decision")).toHaveText("NEUTRAL");
  await expect(page.locator("#decision")).toHaveClass(/neutral/);
});

test("disclaimer and microphone-only notice are visible", async ({ page }) => {
  const disclaimer = page.locator(".disclaimer");
  await expect(disclaimer).toBeVisible();
  await expect(disclaimer).toContainText("Advisory only — fair play preserved.");
  await expect(disclaimer).toContainText("never automates gameplay");

  const micNotice = page.locator(".notice.mic-help");
  await expect(micNotice).toBeVisible();
  await expect(micNotice).toContainText("Microphone only:");
  await expect(micNotice).toContainText("Choose Microphone");
  await expect(micNotice).toContainText("Virtual loopback devices");
});

test("tab navigation switches between Coach, Library, and Session", async ({ page }) => {
  const coachTab = page.getByRole("tab", { name: "Live Coach" });
  const libraryTab = page.getByRole("tab", { name: "Cue Library" });
  const sessionTab = page.getByRole("tab", { name: "Analysis Session" });

  await expect(page.locator("#tab-coach")).toHaveClass(/active/);
  await expect(coachTab).toHaveAttribute("aria-selected", "true");

  await libraryTab.click();
  await expect(page.locator("#tab-library")).toHaveClass(/active/);
  await expect(libraryTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#tab-coach")).not.toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: "Cue Library" })).toBeVisible();

  await sessionTab.click();
  await expect(page.locator("#tab-session")).toHaveClass(/active/);
  await expect(sessionTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Analysis Session" })).toBeVisible();

  await coachTab.click();
  await expect(page.locator("#tab-coach")).toHaveClass(/active/);
  await expect(coachTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#chooseMicrophone")).toBeVisible();
});

test("choose microphone flow updates microphone state", async ({ page }) => {
  await expect(page.locator("#microphoneState")).toHaveText("Click Choose Microphone");

  await page.locator("#chooseMicrophone").click();

  await expect(page.locator("#microphoneState")).toHaveText("Fake Test Microphone", {
    timeout: 10_000,
  });
  await expect(page.locator("#deviceSelect option")).toHaveCount(1);
  await expect(page.locator("#deviceSelect")).toHaveValue("fake-mic-e2e-1");
});

test("loading cue file enables Start button after microphone is chosen", async ({ page }) => {
  await expect(page.locator("#startService")).toBeDisabled();

  await page.locator("#cueFiles").setInputFiles(testCuePath);

  await expect(page.locator("#cueCount")).toHaveText("1", { timeout: 15_000 });
  await expect(page.locator("#serviceState")).toHaveText("Idle");
  await expect(page.locator("#startService")).toBeDisabled();

  await page.locator("#chooseMicrophone").click();
  await expect(page.locator("#microphoneState")).toHaveText("Fake Test Microphone", {
    timeout: 10_000,
  });

  await expect(page.locator("#startService")).toBeEnabled({ timeout: 10_000 });
});

test("status grid shows Audio, Microphone, Cues, and Service labels", async ({ page }) => {
  const grid = page.locator(".status-grid");

  await expect(grid.locator(".label", { hasText: "Audio" })).toBeVisible();
  await expect(grid.locator(".label", { hasText: "Microphone" })).toBeVisible();
  await expect(grid.locator(".label", { hasText: "Cues" })).toBeVisible();
  await expect(grid.locator(".label", { hasText: "Service" })).toBeVisible();

  await expect(page.locator("#audioState")).toHaveText("Locked");
  await expect(page.locator("#microphoneState")).toHaveText("Click Choose Microphone");
  await expect(page.locator("#cueCount")).toHaveText("0");
  await expect(page.locator("#serviceState")).toHaveText("Idle");
});