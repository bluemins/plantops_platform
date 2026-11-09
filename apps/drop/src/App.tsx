import { useEffect, useRef, useState } from "react";
import { App as KApp } from "konsta/react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Gift, House, LogOut, MessageCircleQuestion, RefreshCw } from "lucide-react";
import { API, call, type Look } from "./api";
import { DropMark } from "./art";
import { startPush } from "./push";
import { clearToken, loadToken, saveToken } from "./session";
import { applyBrand } from "./theme";
import { t } from "./text/en";
import { Login } from "./screens/Login";
import { HomeScreen } from "./screens/Home";
import { PointsScreen } from "./screens/Points";
import { PollsScreen } from "./screens/Polls";

type Tab = "home" | "points" | "polls";

export default function App() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [look, setLook] = useState<Look | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [refresh, setRefresh] = useState(0);
  const [logoOk, setLogoOk] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadToken().then(setToken);
    void call<Look>("/api/app/v1/look").then((r) => {
      if (!r.ok) return;
      setLook(r.data);
      applyBrand(r.data.brand_color);
    });
  }, []);

  // Android back button: another tab → Home; Home → leave the app
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener("backButton", () => (tabRef.current !== "home" ? setTab("home") : CapApp.exitApp()));
    const r = CapApp.addListener("resume", () => setRefresh((n) => n + 1));
    return () => {
      void h.then((x) => x.remove());
      void r.then((x) => x.remove());
    };
  }, []);

  // pushes for this login: asks once, signs the phone up; a tapped push opens its tab
  useEffect(() => (token ? startPush(token, setTab) : undefined), [token]);

  // a new tab starts at its top
  // (braces: newer web views return a Promise from scrollTo, and React would call it as the clean-up → crash)
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [tab]);

  const ended = () => {
    void clearToken();
    setToken(null);
    setTab("home");
  };
  const logout = async () => {
    if (token) await call("/api/app/v1/logout", { token, body: {} });
    ended();
  };

  if (token === undefined) return <KApp theme="material" safeAreas />;
  if (!token)
    return (
      <KApp theme="material" safeAreas>
        <div className="h-full overflow-y-auto">
          <Login
            look={look}
            onIn={async (tk) => {
              await saveToken(tk);
              setToken(tk);
            }}
          />
        </div>
      </KApp>
    );

  const tabs: { id: Tab; label: string; Icon: typeof House }[] = [
    { id: "home", label: t.tabs.home, Icon: House },
    { id: "points", label: t.tabs.points, Icon: Gift },
    { id: "polls", label: t.tabs.polls, Icon: MessageCircleQuestion },
  ];
  const iconBtn = "flex h-11 w-11 items-center justify-center rounded-full active:bg-white/15";
  return (
    <KApp theme="material" safeAreas>
      <div className="flex h-full flex-col bg-page">
        <header className="flex shrink-0 items-center justify-between bg-brand pt-[env(safe-area-inset-top)] pr-3 pl-5 text-on-brand">
          <div className="flex h-16 items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white">
              {look?.has_logo && logoOk ? <img src={`${API}/api/app/v1/logo`} alt="" className="h-full w-full object-contain" onError={() => setLogoOk(false)} /> : <DropMark />}
            </span>
            <span className="font-display text-2xl font-extrabold">{t.app}</span>
          </div>
          <div className="flex gap-1">
            <button type="button" className={iconBtn} onClick={() => setRefresh((n) => n + 1)} aria-label={t.common.refresh}>
              <RefreshCw className="h-[22px] w-[22px]" aria-hidden />
            </button>
            <button type="button" className={iconBtn} onClick={logout} aria-label={t.common.logout}>
              <LogOut className="h-[22px] w-[22px]" aria-hidden />
            </button>
          </div>
        </header>

        <main ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          {tab === "home" && <HomeScreen key={`h${refresh}`} token={token} onEnded={ended} goPoints={() => setTab("points")} />}
          {tab === "points" && <PointsScreen key={`p${refresh}`} token={token} onEnded={ended} />}
          {tab === "polls" && <PollsScreen key={`q${refresh}`} token={token} onEnded={ended} />}
        </main>

        <nav aria-label={t.app} className="grid shrink-0 grid-cols-3 border-t border-line bg-white px-3 pt-2 pb-[max(14px,env(safe-area-inset-bottom))]">
          {tabs.map(({ id, label, Icon }) => {
            const on = tab === id;
            return (
              <button key={id} type="button" onClick={() => setTab(id)} aria-current={on ? "page" : undefined} className={`flex flex-col items-center gap-1 text-[13px] ${on ? "font-bold text-link" : "font-semibold text-muted"}`}>
                <span className={`flex h-8 w-16 items-center justify-center rounded-full ${on ? "bg-soft" : ""}`}>
                  <Icon className="h-[22px] w-[22px]" aria-hidden />
                </span>
                {label}
              </button>
            );
          })}
        </nav>
      </div>
    </KApp>
  );
}
