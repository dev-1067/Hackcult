import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge, Card, EmptyState, ErrorBox, PageHeader, Select, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { date } from "../lib/format";
import type { Role, User } from "../lib/types";

const ROLE_HELP: Record<Role, string> = {
  viewer: "Read and search",
  contributor: "Upload, run OCR, suggest fixes",
  curator: "Approve fixes, export data, manage sites",
  admin: "Everything, including users",
};

export default function Users() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ items: User[] }>("/admin/users") });
  const update = useMutation({
    mutationFn: ({ id, role, is_active }: { id: string; role: Role; is_active: boolean }) => api.patch<User>(`/admin/users/${id}`, { role, is_active }),
    onSuccess: (u) => {
      toast.success(`${u.name} is now ${u.is_active ? u.role : "disabled"}`);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-7 sm:px-8">
      <PageHeader title="Users" subtitle="Roles decide what each person can do. Every change is written to the audit log." />
      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
          <div key={r} className="rounded-xl border border-line bg-surface p-3">
            <div className="text-[12.5px] font-semibold capitalize">{r}</div>
            <div className="text-[11.5px] text-muted">{ROLE_HELP[r]}</div>
          </div>
        ))}
      </div>
      <Card className="overflow-hidden">
        {q.error ? (
          <div className="p-4"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>
        ) : q.isLoading ? (
          <Skeleton className="m-4 h-48" />
        ) : q.data?.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Person", "Joined", "Role", "Status"].map((h) => (
                    <th key={h} className="eyebrow px-5 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {q.data.items.map((u) => (
                  <tr key={u.id}>
                    <td className="px-5 py-3">
                      <div className="font-medium text-ink">
                        {u.name} {u.id === me?.id && <Badge className="ml-1">You</Badge>}
                      </div>
                      <div className="text-[12px] text-muted">{u.email}</div>
                    </td>
                    <td className="px-5 py-3 text-muted">{date(u.created_at)}</td>
                    <td className="px-5 py-3">
                      <Select
                        value={u.role}
                        disabled={u.id === me?.id || update.isPending}
                        onChange={(e) => update.mutate({ id: u.id, role: e.target.value as Role, is_active: u.is_active })}
                        className="h-8 w-36 text-[12.5px]"
                        aria-label={`Role for ${u.name}`}
                      >
                        {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-5 py-3">
                      <label className="flex items-center gap-2 text-[12.5px]">
                        <input
                          type="checkbox"
                          checked={u.is_active}
                          disabled={u.id === me?.id || update.isPending}
                          onChange={(e) => update.mutate({ id: u.id, role: u.role, is_active: e.target.checked })}
                          className="accent-[var(--accent)]"
                        />
                        {u.is_active ? "Active" : "Disabled"}
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<UsersIcon className="size-5" />} title="No users" />
        )}
      </Card>
    </div>
  );
}
