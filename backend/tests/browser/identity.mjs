import assert from "node:assert/strict";

export async function createAuthContext(browser) {
  const context = await browser.newContext();
  if (process.env.AUTH_SYSTEM_CA === "1") {
    // Let Node's configured CA store verify HTTPS behind a corporate TLS proxy.
    await context.route("https://**/*", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response });
    });
  }
  return context;
}

export async function signInWithPasskey(app, { name, credentials = [] } = {}) {
  const [provider] = await Promise.all([
    app.waitForEvent("popup"),
    app.getByRole("button", { name: /^(Sign in|Sign in with Internet Identity)$/ }).last().click(),
  ]);
  const session = await app.context().newCDPSession(provider);
  await session.send("WebAuthn.enable");
  const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  for (const credential of credentials) {
    await session.send("WebAuthn.addCredential", { authenticatorId, credential });
  }
  await provider.waitForURL("https://id.ai/authorize*");
  assert.equal(new URL(provider.url()).origin, "https://id.ai");
  if (name) {
    await provider.getByRole("button", { name: "Create", exact: true }).click();
    await provider.getByRole("button", { name: "Create with passkey", exact: true }).click();
    await provider.getByPlaceholder("Identity name").fill(name);
    await provider.getByRole("button", { name: "Create identity", exact: true }).click();
  } else {
    const passkey = provider.getByRole("button", { name: "Sign in with passkey", exact: true });
    const consent = provider.getByRole("button", { name: "Continue", exact: true });
    await passkey.or(consent).waitFor();
    if (await passkey.isVisible()) await passkey.click();
  }
  await provider.getByRole("button", { name: "Continue", exact: true }).waitFor();
  const result = await session.send("WebAuthn.getCredentials", { authenticatorId });
  await Promise.all([
    provider.waitForEvent("close"),
    provider.getByRole("button", { name: "Continue", exact: true }).click(),
  ]);
  await app.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  return result.credentials;
}
