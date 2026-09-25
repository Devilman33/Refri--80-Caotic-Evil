import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "./api/client";
import type { Page, SampleSearchFilters, SampleWithLocation, UserRead } from "./api/types";
import { FiltersBar } from "./components/FiltersBar";
import { Header } from "./components/Header";
import { Pagination } from "./components/Pagination";
import { SampleDetail } from "./components/SampleDetail";
import { SamplesTable } from "./components/SamplesTable";

const THEME_KEY = "refri:theme";
const MY_INITIALS_KEY = "refri:mis-iniciales";
const DEFAULT_PAGE_SIZE = 25;

type Theme = "light" | "dark";

function readTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [filters, setFilters] = useState<SampleSearchFilters>({ page: 1, page_size: DEFAULT_PAGE_SIZE });
  const [result, setResult] = useState<Page<SampleWithLocation> | null>(null);
  const [users, setUsers] = useState<UserRead[]>([]);
  const [selected, setSelected] = useState<SampleWithLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myInitials, setMyInitials] = useState(() => localStorage.getItem(MY_INITIALS_KEY) ?? "");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(MY_INITIALS_KEY, myInitials);
  }, [myInitials]);

  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .searchSamples(filters)
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "No se pudo cargar el listado");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const ownerLookup = useMemo(() => {
    const map: Record<number, string> = {};
    for (const user of users) map[user.id] = user.initials;
    return map;
  }, [users]);

  const myFilterActive = Boolean(
    myInitials.trim() && filters.owner_initials?.toUpperCase() === myInitials.trim().toUpperCase(),
  );

  function toggleMyFilter() {
    const initials = myInitials.trim().toUpperCase();
    if (!initials) return;
    setFilters((current) => ({
      ...current,
      owner_initials: myFilterActive ? undefined : initials,
      page: 1,
    }));
  }

  return (
    <div className="app">
      <Header theme={theme} onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />
      <main className="app-main">
        <FiltersBar
          filters={filters}
          onChange={setFilters}
          myInitials={myInitials}
          onMyInitialsChange={setMyInitials}
          myFilterActive={myFilterActive}
          onToggleMyFilter={toggleMyFilter}
        />

        {loading && <div className="empty-state">Cargando muestras…</div>}
        {error && !loading && (
          <div className="empty-state" role="alert">
            {error}
          </div>
        )}
        {!loading && !error && result && (
          <>
            <SamplesTable samples={result.items} ownerLookup={ownerLookup} onSelect={setSelected} />
            <Pagination
              page={result.page}
              pageSize={result.page_size}
              total={result.total}
              onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
            />
          </>
        )}
      </main>

      {selected && (
        <SampleDetail
          sample={selected}
          ownerLabel={ownerLookup[selected.owner_id] ?? "—"}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
