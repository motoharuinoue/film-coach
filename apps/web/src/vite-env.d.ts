/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 解析サービス（services/analyzer）の URL。公開デモでは設定しない */
  readonly VITE_ANALYZER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
