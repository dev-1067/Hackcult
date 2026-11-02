import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { MATERIALS } from "../lib/format";
import { useMeta, useSites } from "../lib/queries";
import type { Manuscript } from "../lib/types";
import { Button, Field, Input, Modal, Select, Textarea } from "./ui";

interface FormState {
  title: string;
  language: string;
  century: string;
  material: string;
  repository: string;
  site_id: string;
  description: string;
  license: string;
  source_url: string;
}

const EMPTY: FormState = {
  title: "",
  language: "sa",
  century: "",
  material: "paper",
  repository: "",
  site_id: "",
  description: "",
  license: "",
  source_url: "",
};

export function ManuscriptForm({
  open,
  onClose,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Manuscript;
  onSaved: (m: Manuscript) => void;
}) {
  const meta = useMeta();
  const sites = useSites();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      initial
        ? {
            title: initial.title,
            language: initial.language,
            century: initial.century ? String(initial.century) : "",
            material: initial.material,
            repository: initial.repository,
            site_id: initial.site_id ?? "",
            description: initial.description,
            license: initial.license,
            source_url: initial.source_url,
          }
        : EMPTY,
    );
  }, [open, initial]);

  const save = useMutation({
    mutationFn: (body: object) => (initial ? api.patch<Manuscript>(`/manuscripts/${initial.id}`, body) : api.post<Manuscript>("/manuscripts", body)),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["manuscripts"] });
      qc.invalidateQueries({ queryKey: ["manuscript", m.id] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast.success(initial ? "Manuscript updated" : "Manuscript created. Now add its pages.");
      onSaved(m);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (form.title.trim().length < 2) errs.title = "Give the manuscript a title";
    const c = form.century ? Number(form.century) : null;
    if (form.century && (!Number.isInteger(c) || c! < 1 || c! > 21)) errs.century = "Century must be between 1 and 21";
    if (form.source_url && !/^https?:\/\//.test(form.source_url)) errs.source_url = "Start with http:// or https://";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate({
      title: form.title.trim(),
      language: form.language,
      century: c,
      material: form.material,
      repository: form.repository.trim(),
      site_id: form.site_id || null,
      description: form.description.trim(),
      license: form.license.trim(),
      source_url: form.source_url.trim(),
    });
  }

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Edit manuscript" : "New manuscript"}
      subtitle="Catalogue details help people find and trust this text."
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="ms-form" loading={save.isPending}>
            {initial ? "Save changes" : "Create manuscript"}
          </Button>
        </>
      }
    >
      <form id="ms-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <Field label="Title" error={errors.title}>
            <Input value={form.title} onChange={set("title")} placeholder="e.g. Bhagavad Gītā with commentary" />
          </Field>
        </div>
        <Field label="Language" hint="The script is chosen from the language">
          <Select value={form.language} onChange={set("language")}>
            {meta.data?.languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.script})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Century (CE)" error={errors.century} hint="Leave empty if undated">
          <Input type="number" min={1} max={21} value={form.century} onChange={set("century")} placeholder="18" />
        </Field>
        <Field label="Material">
          <Select value={form.material} onChange={set("material")}>
            {Object.entries(MATERIALS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Associated place" hint="Shown on the heritage map">
          <Select value={form.site_id} onChange={set("site_id")}>
            <option value="">None</option>
            {sites.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.city ? ` — ${s.city}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Repository / owner">
          <Input value={form.repository} onChange={set("repository")} placeholder="e.g. Oriental Institute, Vadodara" />
        </Field>
        <Field label="Licence">
          <Input value={form.license} onChange={set("license")} placeholder="e.g. CC BY-SA 4.0" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Source URL" error={errors.source_url}>
            <Input value={form.source_url} onChange={set("source_url")} placeholder="https://" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description">
            <Textarea rows={3} value={form.description} onChange={set("description")} placeholder="Contents, scribe, condition, provenance…" />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
