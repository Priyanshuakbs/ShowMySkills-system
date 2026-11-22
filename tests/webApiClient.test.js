import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
globalThis.window = { location: { hostname: "localhost" } };
globalThis.localStorage = local;
globalThis.sessionStorage = session;
process.env.NEXT_PUBLIC_API_URL = "http://api.test/api";

const { apiRequest, authService, collegeService, notificationService, tokenStorage, uploadService } = await import("../web/src/services/apiClient.js");

test("token storage supports persistent and tab-only sessions and clears both", () => {
  tokenStorage.setTokens({ accessToken: "access-a", refreshToken: "refresh-a" });
  assert.equal(local.getItem("accessToken"), "access-a");
  assert.equal(session.getItem("accessToken"), null);
  assert.equal(tokenStorage.getAccessToken(), "access-a");

  tokenStorage.setTokens({ accessToken: "access-b", refreshToken: "refresh-b" }, "sessionStorage");
  assert.equal(local.getItem("accessToken"), null);
  assert.equal(session.getItem("accessToken"), "access-b");
  assert.equal(tokenStorage.getRefreshToken(), "refresh-b");

  tokenStorage.clearTokens();
  assert.equal(tokenStorage.getAccessToken(), null);
  assert.equal(tokenStorage.getRefreshToken(), null);
});

test("API client sends Bearer access token and allows public calls without one", async (t) => {
  tokenStorage.clearTokens();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ success: true, data: [] });
  };

  await apiRequest("/public");
  assert.equal(calls[0].options.headers.Authorization, undefined);

  tokenStorage.setTokens({ accessToken: "safe-access" });
  await apiRequest("/protected");
  assert.equal(calls[1].options.headers.Authorization, "Bearer safe-access");
  assert.equal(calls[1].url, "http://api.test/api/protected");
  t.after(() => tokenStorage.clearTokens());
});

test("profile upload services send authenticated multipart avatar and resume requests", async (t) => {
  tokenStorage.setTokens({ accessToken: "profile-upload-token" });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ success: true, data: { url: "saved-url" } }, { status: 201 });
  };
  const avatar = new Blob(["avatar"], { type: "image/png" });
  const resume = new Blob(["resume"], { type: "application/pdf" });

  await uploadService.uploadAvatar(avatar);
  await uploadService.uploadResume(resume);

  assert.equal(calls[0].url, "http://api.test/api/upload/avatar");
  assert.equal(calls[1].url, "http://api.test/api/upload/resume");
  for (const call of calls) {
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers.Authorization, "Bearer profile-upload-token");
    assert.ok(call.options.body instanceof FormData);
    assert.equal(call.options.body.get("file").size > 0, true);
    assert.equal(call.options.headers["Content-Type"], undefined);
  }
  t.after(() => tokenStorage.clearTokens());
});

test("avatar upload failures are surfaced to the profile UI", async (t) => {
  tokenStorage.setTokens({ accessToken: "avatar-upload-token" });
  globalThis.fetch = async () => Response.json(
    { success: false, message: "Image is too large" },
    { status: 413 }
  );
  const avatar = new Blob(["avatar"], { type: "image/png" });
  await assert.rejects(uploadService.uploadAvatar(avatar), /Image is too large/);
  t.after(() => tokenStorage.clearTokens());
});

test("resume download uses an authenticated same-origin blob request and rejects external URLs", async (t) => {
  tokenStorage.setTokens({ accessToken: "resume-download-token" });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response("private resume", { status: 200, headers: { "Content-Type": "application/pdf" } });
  };

  const blob = await uploadService.downloadResume("http://api.test/uploads/resumes/student.pdf");
  assert.equal(await blob.text(), "private resume");
  assert.equal(calls[0].url, "http://api.test/uploads/resumes/student.pdf");
  assert.equal(calls[0].options.headers.Authorization, "Bearer resume-download-token");

  await assert.rejects(
    uploadService.downloadResume("https://untrusted.example/resume.pdf"),
    /not available from this account/
  );
  assert.equal(calls.length, 1, "external URLs must not receive authenticated requests");
  await assert.rejects(uploadService.downloadResume(""), /No resume is available/);
  t.after(() => tokenStorage.clearTokens());
});

test("profile update service returns saved profile data and surfaces save errors", async (t) => {
  tokenStorage.setTokens({ accessToken: "profile-edit-token" });
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return Response.json({ success: true, data: { name: "Updated Student", completionPercentage: 70 } });
  };
  const saved = await authService.updateCurrentUser({ name: "Updated Student" });
  assert.equal(request.url, "http://api.test/api/auth/me");
  assert.equal(request.options.method, "PUT");
  assert.equal(request.options.headers.Authorization, "Bearer profile-edit-token");
  assert.equal(saved.data.name, "Updated Student");

  globalThis.fetch = async () => Response.json(
    { success: false, message: "Profile validation failed" },
    { status: 400 }
  );
  await assert.rejects(authService.updateCurrentUser({ name: "" }), /Profile validation failed/);
  t.after(() => tokenStorage.clearTokens());
});

test("login stores access and refresh tokens from backend data and strips them from user profile storage", async (t) => {
  tokenStorage.clearTokens();
  globalThis.fetch = async () => Response.json({
    success: true,
    data: { id: "user-1", email: "person@example.test", accessToken: "login-access", refreshToken: "login-refresh" },
  });

  const result = await authService.login("person@example.test", "password", "student");
  assert.equal(result.data.accessToken, "login-access");
  assert.equal(tokenStorage.getAccessToken(), "login-access");
  assert.equal(tokenStorage.getRefreshToken(), "login-refresh");
  assert.equal(JSON.parse(local.getItem("user")).accessToken, undefined);
  assert.equal(JSON.parse(local.getItem("user")).refreshToken, undefined);
  t.after(() => tokenStorage.clearTokens());
});

test("email verification stores tokens centrally and never puts tokens in user profile storage", async (t) => {
  tokenStorage.clearTokens();
  globalThis.fetch = async () => Response.json({
    success: true,
    data: {
      _id: "user-2",
      email: "verified@example.test",
      accessToken: "verified-access",
      refreshToken: "verified-refresh",
    },
  });

  const result = await authService.verifyEmail("verified@example.test", "123456");
  assert.equal(result.success, true);
  assert.equal(tokenStorage.getAccessToken(), "verified-access");
  assert.equal(tokenStorage.getRefreshToken(), "verified-refresh");
  assert.deepEqual(JSON.parse(local.getItem("user")), {
    _id: "user-2",
    email: "verified@example.test",
  });
  t.after(() => tokenStorage.clearTokens());
});

test("registration stores returned auth data centrally without assuming tokens exist", async (t) => {
  tokenStorage.clearTokens();
  globalThis.fetch = async () => Response.json({
    success: true,
    data: {
      id: "user-3",
      email: "registered@example.test",
      accessToken: "register-access",
      refreshToken: "register-refresh",
    },
  });

  await authService.register({ email: "registered@example.test" });
  assert.equal(tokenStorage.getAccessToken(), "register-access");
  assert.deepEqual(JSON.parse(local.getItem("user")), {
    id: "user-3",
    email: "registered@example.test",
  });

  tokenStorage.clearTokens();
  local.removeItem("user");
  globalThis.fetch = async () => Response.json({
    success: true,
    data: { id: "user-4", email: "unverified@example.test" },
  });
  await authService.register({ email: "unverified@example.test" });
  assert.equal(tokenStorage.getAccessToken(), null);
  assert.equal(local.getItem("user"), null);
  t.after(() => tokenStorage.clearTokens());
});

test("401 refresh rotates tokens once and retries with the new access token", async (t) => {
  tokenStorage.setTokens({ accessToken: "expired-access", refreshToken: "old-refresh" });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/auth/refresh")) {
      return Response.json({ success: true, data: { accessToken: "fresh-access", refreshToken: "fresh-refresh" } });
    }
    if (options.headers.Authorization === "Bearer expired-access") {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ success: true, data: { ok: true } });
  };

  const result = await apiRequest("/protected");
  assert.deepEqual(result.data, { ok: true });
  assert.equal(calls.filter(({ url }) => url.endsWith("/auth/refresh")).length, 1);
  assert.equal(calls.at(-1).options.headers.Authorization, "Bearer fresh-access");
  assert.equal(tokenStorage.getRefreshToken(), "fresh-refresh");
  t.after(() => tokenStorage.clearTokens());
});

test("concurrent 401 responses share one refresh request", async (t) => {
  tokenStorage.setTokens({ accessToken: "expired", refreshToken: "refresh" });
  let refreshCalls = 0;
  let finishRefresh;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/auth/refresh")) {
      refreshCalls += 1;
      return new Promise((resolve) => { finishRefresh = resolve; });
    }
    if (options.headers.Authorization === "Bearer expired") {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ success: true, data: "ok" });
  };

  const first = apiRequest("/protected/a");
  const second = apiRequest("/protected/b");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshCalls, 1);
  finishRefresh(Response.json({ success: true, data: { accessToken: "fresh", refreshToken: "rotated" } }));
  const results = await Promise.all([first, second]);
  assert.equal(results.length, 2);
  t.after(() => tokenStorage.clearTokens());
});

test("failed refresh clears authentication state and rejects the protected request", async (t) => {
  tokenStorage.setTokens({ accessToken: "expired", refreshToken: "revoked" });
  local.setItem("user", JSON.stringify({ id: "user-1" }));
  globalThis.fetch = async (url) => url.endsWith("/auth/refresh")
    ? Response.json({ message: "Unauthorized" }, { status: 401 })
    : Response.json({ message: "Unauthorized" }, { status: 401 });

  await assert.rejects(apiRequest("/protected"), { status: 401 });
  assert.equal(tokenStorage.getAccessToken(), null);
  assert.equal(tokenStorage.getRefreshToken(), null);
  assert.equal(local.getItem("user"), null);
  t.after(() => tokenStorage.clearTokens());
});

test("refresh transport and malformed-response failures clear the cached session", async (t) => {
  for (const failRefresh of [
    async () => { throw new TypeError("network unavailable"); },
    async () => new Response("not json", { status: 200 }),
  ]) {
    tokenStorage.setTokens({ accessToken: "expired", refreshToken: "refresh" });
    local.setItem("user", JSON.stringify({ id: "user-1" }));
    globalThis.fetch = async (url, options) => {
      if (url.endsWith("/auth/refresh")) return failRefresh();
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    };

    await assert.rejects(apiRequest("/protected"), { status: 401 });
    assert.equal(tokenStorage.getAccessToken(), null);
    assert.equal(tokenStorage.getRefreshToken(), null);
    assert.equal(local.getItem("user"), null);
  }
  t.after(() => tokenStorage.clearTokens());
});

test("logout revokes refresh token when possible and clears local auth state", async () => {
  tokenStorage.setTokens({ accessToken: "access", refreshToken: "refresh" });
  globalThis.fetch = async () => Response.json({ success: true });
  await authService.logout();
  assert.equal(tokenStorage.getAccessToken(), null);
  assert.equal(tokenStorage.getRefreshToken(), null);
  assert.equal(local.getItem("user"), null);
});

test("notification read action uses the shared API client with the selected ID", async () => {
  tokenStorage.clearTokens();
  let call;
  globalThis.fetch = async (url, options) => {
    call = { url, options };
    return Response.json({ success: true });
  };

  await notificationService.markRead("notification-1");
  assert.equal(call.url, "http://api.test/api/notifications/mark-read");
  assert.equal(call.options.method, "PUT");
  assert.deepEqual(JSON.parse(call.options.body), { notificationId: "notification-1" });
});

test("college students page uses the authenticated college roster and stable directory IDs", async (t) => {
  tokenStorage.setTokens({ accessToken: "college-access" });
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return Response.json({ success: true, data: [] });
  };

  await collegeService.getStudents();
  assert.equal(request.url, "http://api.test/api/users/college/students");
  assert.equal(request.options.headers.Authorization, "Bearer college-access");

  const collegePage = await readFile(new URL("../web/src/app/college/students/page.jsx", import.meta.url), "utf8");
  const peoplePage = await readFile(new URL("../web/src/app/student/people/page.jsx", import.meta.url), "utf8");
  assert.match(collegePage, /collegeService\.getStudents\(\)/);
  assert.match(collegePage, /id: u\._id \|\| u\.id/);
  assert.match(collegePage, /email: u\.email/);
  assert.match(collegePage, /u\.collegeIdVerified \? "verified" : "pending"/);
  assert.match(peoplePage, /id: u\._id \|\| u\.id \|\| i \+ 1/);
  assert.match(peoplePage, /student\/chats\?user=\$\{candidate\.id\}/);
  t.after(() => tokenStorage.clearTokens());
});
