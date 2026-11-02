import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import type { Role } from "./lib/types";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Manuscripts = lazy(() => import("./pages/Manuscripts"));
const ManuscriptDetail = lazy(() => import("./pages/ManuscriptDetail"));
const PageViewer = lazy(() => import("./pages/PageViewer"));
const SearchPage = lazy(() => import("./pages/Search"));
const Review = lazy(() => import("./pages/Review"));
const Contributions = lazy(() => import("./pages/Contributions"));
const MapPage = lazy(() => import("./pages/MapPage"));
const Trails = lazy(() => import("./pages/Trails"));
const TrailDetail = lazy(() => import("./pages/TrailDetail"));
const Lab = lazy(() => import("./pages/Lab"));
const Dataset = lazy(() => import("./pages/Dataset"));
const Jobs = lazy(() => import("./pages/Jobs"));
const UsersPage = lazy(() => import("./pages/Users"));
const Audit = lazy(() => import("./pages/Audit"));
const Profile = lazy(() => import("./pages/Profile"));
const NotFound = lazy(() => import("./pages/NotFound"));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(role)) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-display text-2xl font-semibold">You don't have access to this page</h1>
        <p className="mt-2 text-muted">This area needs the {role} role. Ask an administrator if you need access.</p>
      </div>
    );
  }
  return <>{children}</>;
}

const Fallback = (
  <div className="flex h-64 items-center justify-center">
    <Spinner className="size-5" />
  </div>
);

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Suspense fallback={Fallback}><Dashboard /></Suspense>} />
        <Route path="manuscripts" element={<Suspense fallback={Fallback}><Manuscripts /></Suspense>} />
        <Route path="manuscripts/:id" element={<Suspense fallback={Fallback}><ManuscriptDetail /></Suspense>} />
        <Route path="pages/:id" element={<Suspense fallback={Fallback}><PageViewer /></Suspense>} />
        <Route path="search" element={<Suspense fallback={Fallback}><SearchPage /></Suspense>} />
        <Route path="review" element={<RequireRole role="curator"><Suspense fallback={Fallback}><Review /></Suspense></RequireRole>} />
        <Route path="contributions" element={<RequireRole role="contributor"><Suspense fallback={Fallback}><Contributions /></Suspense></RequireRole>} />
        <Route path="map" element={<Suspense fallback={Fallback}><MapPage /></Suspense>} />
        <Route path="trails" element={<Suspense fallback={Fallback}><Trails /></Suspense>} />
        <Route path="trails/:id" element={<Suspense fallback={Fallback}><TrailDetail /></Suspense>} />
        <Route path="lab" element={<Suspense fallback={Fallback}><Lab /></Suspense>} />
        <Route path="dataset" element={<RequireRole role="curator"><Suspense fallback={Fallback}><Dataset /></Suspense></RequireRole>} />
        <Route path="jobs" element={<RequireRole role="contributor"><Suspense fallback={Fallback}><Jobs /></Suspense></RequireRole>} />
        <Route path="users" element={<RequireRole role="admin"><Suspense fallback={Fallback}><UsersPage /></Suspense></RequireRole>} />
        <Route path="audit" element={<RequireRole role="curator"><Suspense fallback={Fallback}><Audit /></Suspense></RequireRole>} />
        <Route path="profile" element={<Suspense fallback={Fallback}><Profile /></Suspense>} />
        <Route path="*" element={<Suspense fallback={Fallback}><NotFound /></Suspense>} />
      </Route>
    </Routes>
  );
}
