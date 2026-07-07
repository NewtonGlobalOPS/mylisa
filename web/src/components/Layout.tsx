import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/dashboard", label: "Today" },
  { to: "/timetable", label: "Timetable" },
  { to: "/students", label: "Students" },
  { to: "/screenings", label: "Screenings" },
  { to: "/lesson-builder", label: "Lesson builder" },
  { to: "/assessments", label: "Assessments" },
  { to: "/report", label: "Report" },
];

export default function Layout({
  title,
  subtitle,
  kicker = "The Newton Centre",
  themeClass,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  kicker?: string;
  themeClass?: string;
}>) {
  return (
    <div className={`app-shell ${themeClass ?? ""}`.trim()}>
      <aside className="app-sidebar" aria-label="Primary navigation">
        <div className="app-brand">
          <span className="app-brand-mark">ML</span>
          <div>
            <strong>MyLisa</strong>
            <span>{kicker}</span>
          </div>
        </div>
        <nav className="app-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `app-nav-link ${isActive ? "app-nav-link-active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div>
            <div className="kicker">{kicker}</div>
            <h1>{title}</h1>
            {subtitle ? <p className="meta lead">{subtitle}</p> : null}
          </div>
          <nav className="app-mobile-nav" aria-label="Mobile navigation">
            {navItems.slice(0, 4).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `app-mobile-link ${isActive ? "app-mobile-link-active" : ""}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
