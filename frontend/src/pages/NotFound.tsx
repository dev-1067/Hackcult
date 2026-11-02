import { Link } from "react-router-dom";
import { Button } from "../components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-6 py-24 text-center">
      <div className="script-text text-[44px] text-accent">अप्राप्त</div>
      <h1 className="font-display mt-2 text-2xl font-semibold">This page is not in the archive</h1>
      <p className="mt-2 text-muted">The link may be old, or the item may have been removed.</p>
      <Link to="/" className="mt-6 inline-block">
        <Button variant="primary">Back to the dashboard</Button>
      </Link>
    </div>
  );
}
