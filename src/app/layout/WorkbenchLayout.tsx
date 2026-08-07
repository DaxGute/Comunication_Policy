import type { ReactNode } from "react";

type Props = {
  left: ReactNode;
  main: ReactNode;
  right: ReactNode;
  bottom: ReactNode;
};

export function WorkbenchLayout({ left, main, right, bottom }: Props) {
  return (
    <div className="workbench">
      <header className="workbench__topbar">
        <div className="workbench__brand">
          Communication Policy Experiment
        </div>
        <div className="workbench__topbar-meta muted">
          Two-agent interpersonal policy workbench
        </div>
      </header>

      <div className="workbench__body">
        <aside className="workbench__left">{left}</aside>
        <main className="workbench__main">{main}</main>
        <aside className="workbench__right">{right}</aside>
      </div>

      <section className="workbench__bottom">{bottom}</section>
    </div>
  );
}
