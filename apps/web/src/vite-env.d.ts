/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 解析サービス（services/analyzer）の URL。公開デモでは設定しない */
  readonly VITE_ANALYZER_URL?: string;
  /** 改善点の文章を書く手元の Ollama の URL。公開デモでは設定しない */
  readonly VITE_OLLAMA_URL?: string;
  /** Ollama のモデル（既定は gemma3:12b） */
  readonly VITE_OLLAMA_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
