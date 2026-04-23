import type { PropsWithChildren } from "react";

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
      <div className="app-wrap">
        <div className="hero-card">
          <div className="kicker">{kicker}</div>
          <h1>{title}</h1>
          {subtitle ? <p className="meta lead">{subtitle}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
