// Loading a screen's data: { loading } → { data } | { offline } | { error }; a 401 session_ended sends the app back
// to the login screen (onEnded).
import { useCallback, useEffect, useState } from "react";
import type { ApiResult } from "./api";

export type Loaded<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "offline" } | { state: "error"; message: string };

export function useLoad<T>(fetcher: () => Promise<ApiResult<T>>, onEnded: () => void) {
  const [s, setS] = useState<Loaded<T>>({ state: "loading" });
  const load = useCallback(async () => {
    setS((x) => (x.state === "ready" ? x : { state: "loading" }));
    const r = await fetcher();
    if (r.ok) return setS({ state: "ready", data: r.data });
    if (r.status === 401) return onEnded();
    setS(r.code === "offline" ? { state: "offline" } : { state: "error", message: r.message });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { s, reload: load, set: (data: T) => setS({ state: "ready", data }) };
}
