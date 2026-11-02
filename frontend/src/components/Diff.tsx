/** Character-level diff (LCS) so reviewers see exactly what a correction changes. */
export function Diff({ before, after }: { before: string; after: string }) {
  const a = Array.from(before);
  const b = Array.from(after);
  // Keep the DP small: very long lines fall back to a plain before/after view.
  if (a.length * b.length > 250_000) {
    return (
      <div className="space-y-1">
        <p className="text-bad line-through">{before}</p>
        <p className="text-good">{after}</p>
      </div>
    );
  }
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const parts: { t: "same" | "del" | "add"; s: string }[] = [];
  const push = (t: "same" | "del" | "add", s: string) => {
    const last = parts[parts.length - 1];
    if (last && last.t === t) last.s += s;
    else parts.push({ t, s });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", a[i++]);
    else push("add", b[j++]);
  }
  while (i < a.length) push("del", a[i++]);
  while (j < b.length) push("add", b[j++]);
  return (
    <span>
      {parts.map((p, k) =>
        p.t === "same" ? (
          <span key={k}>{p.s}</span>
        ) : p.t === "del" ? (
          <del key={k} className="rounded bg-bad-soft text-bad decoration-bad/60">{p.s}</del>
        ) : (
          <ins key={k} className="rounded bg-good-soft text-good no-underline">{p.s}</ins>
        ),
      )}
    </span>
  );
}
