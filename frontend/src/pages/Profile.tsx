import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { date } from "../lib/format";
import type { User } from "../lib/types";

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwError, setPwError] = useState("");

  const saveName = useMutation({
    mutationFn: () => api.patch<User>("/auth/me", { name }),
    onSuccess: (u) => {
      updateUser(u);
      toast.success("Name updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changePw = useMutation({
    mutationFn: () => api.post("/auth/password", { current_password: pw.current, new_password: pw.next }),
    onSuccess: () => {
      toast.success("Password changed");
      setPw({ current: "", next: "", confirm: "" });
    },
    onError: (e: Error) => setPwError(e.message),
  });

  function submitPw(e: FormEvent) {
    e.preventDefault();
    setPwError("");
    if (pw.next.length < 8) return setPwError("New password must be at least 8 characters");
    if (pw.next !== pw.confirm) return setPwError("The new passwords do not match");
    changePw.mutate();
  }

  if (!user) return null;
  return (
    <div className="mx-auto max-w-[760px] px-4 py-7 sm:px-8">
      <PageHeader title="Profile & security" />
      <Card className="mb-4">
        <CardHeader title="Account" subtitle={`Member since ${date(user.created_at)}`} action={<Badge tone="accent" className="uppercase">{user.role}</Badge>} />
        <form
          className="grid gap-4 p-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2) saveName.mutate();
          }}
        >
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email">
            <Input value={user.email} disabled />
          </Field>
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" variant="primary" loading={saveName.isPending} disabled={name.trim().length < 2 || name.trim() === user.name}>
              Save
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <CardHeader title="Change password" subtitle="Passwords are stored as Argon2id hashes." />
        <form className="grid gap-4 p-5" onSubmit={submitPw}>
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New password">
              <Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </Field>
            <Field label="Repeat new password">
              <Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
          </div>
          {pwError && <div className="rounded-lg border border-bad/25 bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{pwError}</div>}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={changePw.isPending} disabled={!pw.current || !pw.next}>
              Change password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
