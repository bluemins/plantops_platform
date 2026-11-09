// The 90-day login token: in Android's Keystore-backed secure storage on the phone; in the browser (development only)
// in localStorage.
import { Capacitor } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

const KEY = "drop.token";
const native = () => Capacitor.isNativePlatform();

export async function loadToken(): Promise<string | null> {
  try {
    return native() ? await SecureStorage.getItem(KEY) : localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function saveToken(token: string) {
  try {
    if (native()) await SecureStorage.setItem(KEY, token);
    else localStorage.setItem(KEY, token);
  } catch {
    /* a phone that can't store it just asks for a code next time */
  }
}

export async function clearToken() {
  try {
    if (native()) await SecureStorage.removeItem(KEY);
    else localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}
