import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages ではリポジトリ名のサブパスで配信するので、BASE_PATH で切り替える
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        // ライブラリは更新頻度が低いので、アプリのコードと分けてキャッシュを効かせる
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            { name: "motion", test: /node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/ },
            { name: "icons", test: /node_modules[\\/]@tabler[\\/]/ },
          ],
        },
      },
    },
  },
});
