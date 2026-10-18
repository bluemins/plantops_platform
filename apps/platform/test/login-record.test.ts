// B-03 (docs/STABILITY_PLAN.md): every successful plant login is written to the audit log with the phone / browser,
// installed app or browser tab, where the login started, and what had happened to the previous session cookie, so
// the cause of repeated logins can be read from the live data. Nothing about the password, and no IP address.
import { beforeAll, describe, expect, it } from "vitest";
import * as loginRoute from "@/app/api/auth/login/route";
import * as logoutRoute from "@/app/api/auth/logout/route";
import { describeClient } from "@/server/client-info";
import { asOwner, call, cookieFrom, makePlant, makeStaff, type Handler } from "./helpers";

const UA = {
  androidChrome: "Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  androidWebView: "Mozilla/5.0 (Linux; Android 12; RMX3261 Build/SP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36",
  firefoxAndroid: "Mozilla/5.0 (Android 13; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  iphoneHomeScreen: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
};

describe("which phone and browser", () => {
  it.each([
    ["androidChrome", "android", "chrome"],
    ["samsung", "android", "samsung"],
    ["androidWebView", "android", "webview"],
    ["firefoxAndroid", "android", "firefox"],
    ["iphoneSafari", "iphone", "safari"],
    ["iphoneChrome", "iphone", "chrome"],
    ["iphoneHomeScreen", "iphone", "webview"], // the iPhone Home Screen app has no "Safari" in its name
    ["windowsChrome", "windows", "chrome"],
    ["windowsEdge", "windows", "edge"],
    ["macSafari", "mac", "safari"],
  ] as const)("%s -> %s / %s", (key, device, browser) => {
    expect(describeClient(UA[key])).toEqual({ device, browser });
  });
  it("nothing known -> other / other", () => expect(describeClient(null)).toEqual({ device: "other", browser: "other" }));
});

let plant: Awaited<ReturnType<typeof makePlant>>;
let other: Awaited<ReturnType<typeof makePlant>>;
beforeAll(async () => {
  plant = await makePlant();
  other = await makePlant();
});

type Details = Record<string, unknown>;
const doLogin = async (p: { code: string }, username: string, pin: string, opts: { cookie?: string; ua?: string; body?: Record<string, unknown> } = {}) =>
  call(loginRoute.POST as Handler, {
    body: { plant_code: p.code, username, secret: pin, ...opts.body },
    cookie: opts.cookie,
    headers: opts.ua ? { "user-agent": opts.ua } : {},
  });
/** This person's login records, without the first one (makeStaff's own login to set the PIN). */
const records = async (userId: string) =>
  (await asOwner<{ actor: string; details: Details }>("select actor, details from platform.audit_log where action = 'user.login' and target = $1 order by id", [userId])).rows.slice(1);

describe("each login is recorded", () => {
  it("phone, browser, installed app, the module link it came from, and no previous cookie", async () => {
    const s = await makeStaff(plant, "dillip", ["store_keeper"]);
    const res = await doLogin(plant, "dillip", s.pin, { ua: UA.androidChrome, body: { installed: true, next: "/sso/start?module=floor_stock&next=%2Fcount" } });
    expect(res.status).toBe(200);
    const [r] = await records(s.userId);
    expect(r!.actor).toBe(`user:${s.userId}`);
    expect(r!.details).toEqual({ device: "android", browser: "chrome", app: "installed", via: "module_link", module: "floor_stock", previous: "none" });
  });

  it("a browser tab from the login page; a strange next is just 'other'", async () => {
    const s = await makeStaff(plant, "gaja", ["store_keeper"]);
    await doLogin(plant, "gaja", s.pin, { ua: UA.iphoneSafari, body: { installed: false } });
    await doLogin(plant, "gaja", s.pin, { ua: UA.iphoneSafari, body: { next: "https://evil.example/x" } });
    const [a, b] = await records(s.userId);
    expect(a!.details).toMatchObject({ device: "iphone", browser: "safari", app: "browser", via: "login_page" });
    expect(b!.details).toMatchObject({ app: "unknown", via: "other" });
    expect(b!.details).not.toHaveProperty("module");
  });

  it("what happened to the previous session: still valid, logged out, expired (and how long ago), unknown", async () => {
    const s = await makeStaff(plant, "anmol", ["order_desk"]);
    const first = cookieFrom((await doLogin(plant, "anmol", s.pin)).setCookie);
    const second = cookieFrom((await doLogin(plant, "anmol", s.pin, { cookie: first })).setCookie); // e.g. a double tap
    await call(logoutRoute.POST as Handler, { cookie: second, body: {} });
    const third = cookieFrom((await doLogin(plant, "anmol", s.pin, { cookie: second })).setCookie);
    await asOwner("update platform.sessions set expires_at = now() - interval '90 minutes' where user_id = $1 and revoked_at is null", [s.userId]);
    await doLogin(plant, "anmol", s.pin, { cookie: third });
    await doLogin(plant, "anmol", s.pin, { cookie: `plantops_session=${plant.tenantId}.not-a-real-session` });
    const rows = (await records(s.userId)).map((r) => r.details);
    expect(rows.map((d) => d.previous)).toEqual(["none", "still_valid", "logged_out", "expired", "unknown"]);
    expect(rows[3]!.ended_minutes_ago).toBeGreaterThanOrEqual(89);
    expect(rows[3]!.ended_minutes_ago).toBeLessThanOrEqual(92);
  });

  it("someone else's cookie on the same phone, or another plant's cookie", async () => {
    const a = await makeStaff(plant, "bindu", ["store_keeper"]);
    const b = await makeStaff(plant, "ramu", ["store_keeper"]);
    const x = await makeStaff(other, "kedar", ["store_keeper"]);
    const bindus = cookieFrom((await doLogin(plant, "bindu", a.pin)).setCookie);
    const kedars = cookieFrom((await doLogin(other, "kedar", x.pin)).setCookie);
    await doLogin(plant, "ramu", b.pin, { cookie: bindus });
    await doLogin(plant, "ramu", b.pin, { cookie: kedars });
    expect((await records(b.userId)).map((r) => r.details.previous)).toEqual(["other_user", "other_plant"]);
  });

  it("a failed login writes no login record", async () => {
    const s = await makeStaff(plant, "reeta", ["store_keeper"]);
    expect((await doLogin(plant, "reeta", "000000")).status).toBe(401);
    expect(await records(s.userId)).toEqual([]);
  });
});
