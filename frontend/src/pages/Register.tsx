import { ArrowRight, Lock, Mail, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AuthShell } from "../components/AuthShell";
import { Button, Field, Input } from "../components/ui";
import { useAuth } from "../lib/auth";

export function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  function validate() {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = "Enter your name";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) e.email = "Enter a valid email address";
    if (form.password.length < 8) e.password = "Use at least 8 characters";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!validate()) return;
    setBusy(true);
    try {
      await register(form.name.trim(), form.email.trim(), form.password);
      toast.success("Account created. You can upload and correct manuscripts.");
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <AuthShell>
      <h1 className="font-display text-[28px] font-semibold text-ink">Join the archive</h1>
      <p className="mt-1 text-[13.5px] text-muted">New accounts can upload manuscripts and suggest corrections.</p>
      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        <Field label="Full name" error={errors.name}>
          <Input icon={<UserRound className="size-4" />} value={form.name} onChange={set("name")} autoComplete="name" placeholder="Ananya Shah" />
        </Field>
        <Field label="Email address" error={errors.email}>
          <Input icon={<Mail className="size-4" />} type="email" value={form.email} onChange={set("email")} autoComplete="email" placeholder="you@college.edu" />
        </Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters">
          <Input icon={<Lock className="size-4" />} type="password" value={form.password} onChange={set("password")} autoComplete="new-password" placeholder="••••••••" />
        </Field>
        {error && <div className="rounded-lg border border-bad/25 bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{error}</div>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Create account <ArrowRight className="size-4" />
        </Button>
      </form>
      <p className="mt-8 text-center text-[13px] text-muted">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
