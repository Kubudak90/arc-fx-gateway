import { test, expect } from "@playwright/test";

test("login page renders SIWE entrypoint", async ({ page }) => {
  await page.goto("/m/login");
  await expect(page.getByText("Sign in to Arcora")).toBeVisible();
  await expect(page.getByRole("button", { name: /Connect wallet/ })).toBeVisible();
});
