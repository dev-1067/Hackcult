import { Check, MapPin, Search } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "./Logo";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full">
      <section className="grain relative hidden w-[52%] overflow-hidden bg-sidebar text-sidebar-ink lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -top-40 -left-32 size-[520px] rounded-full bg-[#c4553a]/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-40 bottom-0 size-[480px] rounded-full bg-[#5a6fa8]/15 blur-3xl" />

        <div className="relative flex items-center gap-2.5 px-10 pt-9">
          <Logo className="size-9" />
          <div>
            <div className="font-display text-lg font-semibold">LipiSetu</div>
            <div className="text-[11px] text-sidebar-muted">लिपि सेतु · a bridge for scripts</div>
          </div>
        </div>

        <div className="relative flex flex-1 items-center px-10">
          <div className="relative h-[330px] w-full max-w-[520px]">
            <div className="absolute top-0 left-0 w-[340px] rotate-[-2deg] rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-md">
              <div className="flex items-center justify-between text-[10.5px] tracking-wider text-sidebar-muted uppercase">
                <span>Line 3 · Bhagavad Gītā 4.7</span>
                <span className="rounded-md bg-[#2f7a4b]/30 px-1.5 py-0.5 font-mono text-[10.5px] text-[#9fdcb2]">94%</span>
              </div>
              <div className="script-text mt-2 text-[20px] text-white">यदा यदा हि धर्मस्य ग्लानिर्भवति भारत ।</div>
              <div className="mt-1 text-[12.5px] text-sidebar-muted italic">yadā yadā hi dharmasya glānirbhavati bhārata</div>
            </div>

            <div className="absolute top-[132px] left-[150px] w-[300px] rotate-[1.5deg] rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-md">
              <div className="flex items-center gap-2 text-[12.5px]">
                <Search className="size-3.5 text-sidebar-muted" />
                <span className="text-white">dharma</span>
                <span className="text-sidebar-muted">→</span>
                <span className="script-text text-white">धर्म</span>
              </div>
              <div className="mt-2 text-[12px] text-sidebar-muted">Found in 3 manuscripts, including folios from the 18th century</div>
            </div>

            <div className="absolute top-[232px] left-[30px] w-[280px] rotate-[-1deg] rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-md">
              <div className="flex items-start gap-3">
                <div className="flex size-8 items-center justify-center rounded-lg bg-[#c4553a]/25 text-[#f0a48c]">
                  <MapPin className="size-4" />
                </div>
                <div>
                  <div className="text-[13px] font-medium text-white">Rani ki Vav, Patan</div>
                  <div className="text-[11.5px] text-sidebar-muted">UNESCO site · 11th century · stop 2 of 4</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative px-10 pb-10">
          <h2 className="font-display max-w-md text-[30px] leading-[1.15] font-semibold text-white">
            Every manuscript, a page anyone can read.
          </h2>
          <p className="mt-3 max-w-md text-[13.5px] text-sidebar-muted">
            Read handwritten Sanskrit, Hindi and Marathi folios, correct them together, search across scripts, and walk to the places they came from.
          </p>
          <ul className="mt-5 space-y-2 text-[13px] text-sidebar-ink/90">
            {["Transformer OCR with our own page clean-up", "Every correction reviewed, every change logged", "Heritage trails planned from where you stand"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="flex size-4 items-center justify-center rounded-full bg-white/10">
                  <Check className="size-3" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex flex-1 items-center justify-center bg-bg px-5 py-10">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Logo className="size-9" />
            <div className="font-display text-lg font-semibold">LipiSetu</div>
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}
