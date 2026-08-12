import type { ReactNode } from "react";

type Crumb = {
  label: string;
  onClick?: () => void;
};

type Props = {
  crumbs: Crumb[];
  actions?: ReactNode;
};

export function CenterPaneHeader({ crumbs, actions }: Props) {
  return (
    <header className="center-pane__header">
      <nav className="center-pane__crumbs" aria-label="Center pane navigation">
        {crumbs.map((crumb, i) => (
          <span key={`${crumb.label}-${i}`} className="center-pane__crumb">
            {i > 0 ? (
              <span className="center-pane__crumb-sep" aria-hidden>
                ›
              </span>
            ) : null}
            {crumb.onClick ? (
              <button
                type="button"
                className="center-pane__crumb-btn"
                onClick={crumb.onClick}
              >
                {crumb.label}
              </button>
            ) : (
              <span className="center-pane__crumb-current">{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>
      {actions ? <div className="center-pane__header-actions">{actions}</div> : null}
    </header>
  );
}
