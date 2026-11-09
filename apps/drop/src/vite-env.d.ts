/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** the Sales customer API, e.g. https://orders.bluemins.life */
  readonly VITE_DROP_API_URL?: string;
}
declare module "konsta-md-colors" {
  const mdColors: (hex: string, scheme?: string) => Record<string, string>;
  export default mdColors;
}
