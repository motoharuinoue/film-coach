import { MotionConfig } from "motion/react";
import { createHashRouter, Navigate, RouterProvider, useParams } from "react-router";
import { AppShell } from "./components/AppShell";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { AnalyzerProvider } from "./state/analyzer";
import { BenchmarksProvider } from "./state/benchmarks";
import { LocalDataProvider } from "./state/local";
import { NarratorProvider } from "./state/narration";

// ホーム以外の画面は、開いたときに読み込む（最初の表示を軽くするため）
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) => ({
  lazy: async () => ({ Component: (await load())[name] }),
});

/** 比較は分析スタジオの中に移したので、旧 URL はスタジオの比較表示へ送る */
function CompareRedirect() {
  const { id } = useParams();
  return <Navigate to={`/sessions/${id}/studio?view=compare`} replace />;
}

// GitHub Pages ではサーバー側のルーティングがないので、ハッシュで画面を切り替える
const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/sessions/new", ...page(() => import("./pages/NewSession"), "NewSession") },
      { path: "/sessions/:id/reps", ...page(() => import("./pages/Reps"), "Reps") },
      { path: "/sessions/:id/studio", ...page(() => import("./pages/Studio"), "Studio") },
      { path: "/sessions/:id/compare", element: <CompareRedirect /> },
      { path: "/sessions/:id/report", ...page(() => import("./pages/Report"), "Report") },
      { path: "/references", ...page(() => import("./pages/References"), "References") },
      { path: "/references/search", ...page(() => import("./pages/ReferenceSearch"), "ReferenceSearch") },
      { path: "/progress", ...page(() => import("./pages/Progress"), "Progress") },
      { path: "/evaluation", ...page(() => import("./pages/evaluation/EvaluationPage"), "EvaluationPage") },
      { path: "/footage", ...page(() => import("./pages/footage/FootageList"), "FootageList") },
      { path: "/footage/:id/pick", ...page(() => import("./pages/footage/FootagePick"), "FootagePick") },
      { path: "/footage/practices/:id", ...page(() => import("./pages/footage/PracticePage"), "PracticePage") },
      { path: "/footage/:id", ...page(() => import("./pages/footage/FootageViewer"), "FootageViewer") },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export function App() {
  return (
    // OS の「視差効果を減らす」設定のときは、動きを抑える
    <MotionConfig reducedMotion="user">
      <AnalyzerProvider>
        <BenchmarksProvider>
          <LocalDataProvider>
            <NarratorProvider>
              <RouterProvider router={router} />
            </NarratorProvider>
          </LocalDataProvider>
        </BenchmarksProvider>
      </AnalyzerProvider>
    </MotionConfig>
  );
}
