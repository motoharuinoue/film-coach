import { Link } from "react-router";
import { Button } from "../components/ui";

export function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="font-display text-7xl text-turf">4TH &amp; LONG</div>
      <h1 className="mt-4 text-xl font-semibold">このページは見つかりません</h1>
      <p className="mt-2 text-sm text-muted">URL を確かめるか、ホームから探してください。</p>
      <Link to="/" className="mt-6">
        <Button variant="primary">ホームへ</Button>
      </Link>
    </div>
  );
}
