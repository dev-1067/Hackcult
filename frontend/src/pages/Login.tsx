import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AuthShell } from "../components/AuthShell";
import { Button, Field, Input } from "../components/ui";
import { useAuth } from "../lib/auth";

const DEMO = [
  { role: "Admin", email: "admin@lipisetu.in" },
  { role: "Curator", email: "curator@lipisetu.in" },
  { role: "Contributor", email: "contributor@lipisetu.in" },
  { role: "Viewer", email: "viewer@lipisetu.in" },
];
const DEMO_PASSWORD = "Lipi@2026";

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (user) return <Navigate to={from} replace />;

  async function signIn(e: string, p: string, key: string) {
    setError("");
    setBusy(key);
    try {
      const u = await login(e, p);
      toast.success(`Welcome, ${u.name.split(" ")[0]}`);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setError("Enter your email and password");
      return;
    }
    signIn(email, password, "form");
  }

  return (
    <AuthShell>
      <h1 className="font-display text-[28px] font-semibold text-ink">Welcome back</h1>
      <p className="mt-1 text-[13.5px] text-muted">Sign in to read, correct and explore the archive.</p>

      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        <Field label="Email address">
          <Input icon={<Mail className="size-4" />} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@college.edu" />
        </Field>
        <Field label="Password">
          <div className="relative">
            <Input
              icon={<Lock className="size-4" />}
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="pr-10"
            />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-1 text-muted hover:text-ink" aria-label={show ? "Hide password" : "Show password"}>
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
        {error && <div className="rounded-lg border border-bad/25 bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{error}</div>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy === "form"}>
          Sign in <ArrowRight className="size-4" />
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-[10.5px] font-semibold tracking-[0.12em] text-muted uppercase">
        <span className="h-px flex-1 bg-line" /> Try a demo account <span className="h-px flex-1 bg-line" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {DEMO.map((d) => (
          <Button key={d.role} variant="secondary" loading={busy === d.role} onClick={() => signIn(d.email, DEMO_PASSWORD, d.role)}>
            {d.role}
          </Button>
        ))}
      </div>
      <p className="mt-2 text-center text-[11.5px] text-muted">Each role sees different tools: viewers read, contributors upload and correct, curators approve.</p>

      <p className="mt-8 text-center text-[13px] text-muted">
        New here?{" "}
        <Link to="/register" className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
