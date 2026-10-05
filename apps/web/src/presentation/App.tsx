import { createHashRouter, RouterProvider } from "react-router";
import { AppShell } from "./components/AppShell";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { BenchmarksProvider } from "./state/benchmarks";

// ホーム以外の画面は、開いたときに読み込む（最初の表示を軽くするため）
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) => ({
  lazy: async () => ({ Component: (await load())[name] }),
});

// GitHub Pages ではサーバー側のルーティングがないので、ハッシュで画面を切り替える
const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/sessions/new", ...page(() => import("./pages/NewSession"), "NewSession") },
      { path: "/sessions/:id/reps", ...page(() => import("./pages/Reps"), "Reps") },
      { path: "/sessions/:id/studio", ...page(() => import("./pages/Studio"), "Studio") },
      { path: "/sessions/:id/compare", ...page(() => import("./pages/Compare"), "Compare") },
      { path: "/sessions/:id/report", ...page(() => import("./pages/Report"), "Report") },
      { path: "/references", ...page(() => import("./pages/References"), "References") },
      { path: "/progress", ...page(() => import("./pages/Progress"), "Progress") },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export function App() {
  return (
    <BenchmarksProvider>
      <RouterProvider router={router} />
    </BenchmarksProvider>
  );
}
