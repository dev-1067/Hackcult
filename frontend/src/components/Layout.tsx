import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  BookOpenText,
  ClipboardCheck,
  Cog,
  Database,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Monitor,
  Moon,
  Route,
  ScrollText,
  Search,
  Sun,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import type { Role } from "../lib/types";
import { Badge, Kbd } from "./ui";
import { Logo } from "./Logo";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  role?: Role;
  badge?: number;
}

const TIPS = [
  "Type in English to search Devanagari: 'dharma' finds धर्म.",
  "Red lines have low confidence. Fix them and a curator will review.",
  "Press Ctrl + K anywhere to jump to search.",
  "Approved corrections become training data for better models.",
  "Build a trail from your location to visit nearby heritage sites.",
];

export function Layout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  const pending = useQuery({
    queryKey: ["corrections-count"],
    queryFn: () => api.get<{ counts: Record<string, number> }>("/corrections?status=pending&limit=1"),
    enabled: can("curator"),
    refetchInterval: 30000,
  });

  useEffect(() => setOpen(false), [location.pathname]);

  const groups: { label: string; items: NavItem[] }[] = [
    { label: "Overview", items: [{ to: "/", label: "Dashboard", icon: <LayoutDashboard /> }] },
    {
      label: "Archive",
      items: [
        { to: "/manuscripts", label: "Manuscripts", icon: <BookOpenText /> },
        { to: "/search", label: "Search", icon: <Search /> },
      ],
    },
    {
      label: "Review",
      items: [
        { to: "/review", label: "Review queue", icon: <ClipboardCheck />, role: "curator", badge: pending.data?.counts?.pending },
        { to: "/contributions", label: "My contributions", icon: <ScrollText />, role: "contributor" },
      ],
    },
    {
      label: "Discover",
      items: [
        { to: "/map", label: "Heritage map", icon: <Map /> },
        { to: "/trails", label: "My trails", icon: <Route /> },
      ],
    },
    {
      label: "Lab",
      items: [
        { to: "/lab", label: "OCR Lab", icon: <FlaskConical /> },
        { to: "/dataset", label: "Training dataset", icon: <Database />, role: "curator" },
        { to: "/jobs", label: "Processing jobs", icon: <Cog />, role: "contributor" },
      ],
    },
    {
      label: "Administration",
      items: [
        { to: "/users", label: "Users", icon: <Users />, role: "admin" },
        { to: "/audit", label: "Audit log", icon: <ScrollText />, role: "curator" },
      ],
    },
  ];

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-ink">
      <div className="flex h-16 items-center justify-between px-5">
        <NavLink to="/" className="flex items-center gap-2.5">
          <Logo className="size-8" />
          <div className="leading-tight">
            <div className="font-display text-[17px] font-semibold">LipiSetu</div>
            <div className="text-[10.5px] tracking-wide text-sidebar-muted">लिपि सेतु · script bridge</div>
          </div>
        </NavLink>
        <button className="rounded-lg p-1.5 text-sidebar-muted hover:bg-white/5 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="size-4" />
        </button>
      </div>
      <nav className="scroll-thin flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((g) => {
          const items = g.items.filter((i) => !i.role || can(i.role));
          if (!items.length) return null;
          return (
            <div key={g.label} className="mt-4">
              <div className="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.12em] text-sidebar-muted/80 uppercase">{g.label}</div>
              {items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.to === "/"}
                  className={({ isActive }) =>
                    clsx(
                      "group flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13.5px] transition-colors [&_svg]:size-[16px]",
                      isActive ? "bg-white/10 font-medium text-white" : "text-sidebar-ink/80 hover:bg-white/5 hover:text-white",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={clsx(isActive ? "text-[#e9896f]" : "text-sidebar-muted group-hover:text-sidebar-ink")}>{i.icon}</span>
                      <span className="flex-1">{i.label}</span>
                      {!!i.badge && (
                        <span className="rounded-full bg-[#c4553a] px-1.5 text-[10.5px] font-semibold text-white tabular-nums">{i.badge}</span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="p-3">
        <div className="rounded-xl border border-white/10 bg-sidebar-2 p-3">
          <div className="text-[10px] font-semibold tracking-[0.12em] text-[#e9896f] uppercase">Tip</div>
          <p className="mt-1 text-[12px] leading-snug text-sidebar-ink/85">{tip}</p>
        </div>
        <div className="mt-2 px-1 text-[10.5px] text-sidebar-muted">LipiSetu v1.0 · HackCult '26</div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-[248px] shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[264px] shadow-pop">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setOpen(true)} onLogout={() => { logout(); navigate("/login"); }} userName={user?.name ?? ""} role={user?.role ?? "viewer"} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Topbar({ onMenu, onLogout, userName, role }: { onMenu: () => void; onLogout: () => void; userName: string; role: Role }) {
  const [theme, setTheme] = useTheme();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const initials = userName.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur sm:px-6">
      <button className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu className="size-5" />
      </button>
      <form
        className="relative max-w-md flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 2) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search manuscripts — try “dharma” or धर्म"
          className="h-9 w-full rounded-lg border border-line bg-surface-2 pr-14 pl-9 text-[13.5px] text-ink placeholder:text-muted/80 focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/15 focus:outline-none"
          aria-label="Search manuscripts"
        />
        <span className="absolute top-1/2 right-2.5 hidden -translate-y-1/2 sm:block">
          <Kbd>Ctrl K</Kbd>
        </span>
      </form>
      <div className="ml-auto flex items-center gap-2">
        <div className="hidden items-center rounded-lg border border-line bg-surface-2 p-0.5 sm:flex" role="group" aria-label="Theme">
          {([
            ["light", <Sun key="l" className="size-3.5" />, "Light"],
            ["system", <Monitor key="s" className="size-3.5" />, "System"],
            ["dark", <Moon key="d" className="size-3.5" />, "Dark"],
          ] as const).map(([v, icon, label]) => (
            <button
              key={v}
              onClick={() => setTheme(v)}
              aria-pressed={theme === v}
              title={`${label} theme`}
              className={clsx("rounded-md p-1.5 transition-colors", theme === v ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}
            >
              {icon}
            </button>
          ))}
        </div>
        <div className="relative">
          <button
            onClick={() => setMenu((m) => !m)}
            className="flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 hover:bg-surface-2"
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label="Account menu"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">{initials}</span>
            <span className="hidden text-[13px] font-medium text-ink md:block">{userName}</span>
            <Badge tone={role === "admin" ? "accent" : role === "curator" ? "indigo" : "neutral"} className="hidden uppercase md:inline-flex">
              {role}
            </Badge>
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div role="menu" className="rise absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-pop">
                <button role="menuitem" onClick={() => { setMenu(false); navigate("/profile"); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-ink hover:bg-surface-2">
                  <UserRound className="size-4 text-muted" /> Profile & security
                </button>
                <div className="flex items-center justify-between px-3 py-2 sm:hidden">
                  <span className="text-[12.5px] text-muted">Theme</span>
                  <select value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)} className="rounded-md border border-line bg-surface px-1 text-[12.5px]">
                    <option value="light">Light</option>
                    <option value="system">System</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>
                <button role="menuitem" onClick={onLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-bad hover:bg-bad-soft">
                  <LogOut className="size-4" /> Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
