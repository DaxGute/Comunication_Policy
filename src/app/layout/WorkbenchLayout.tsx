import type { ReactNode } from "react";
import { ResizableSplit } from "../../components/ui/ResizableSplit";

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

      <ResizableSplit
        direction="vertical"
        className="workbench__shell"
        initialSizes={[58, 42]}
        minSizesPx={[220, 220]}
        storageKey="workbench:shell"
      >
        <ResizableSplit
          direction="horizontal"
          className="workbench__body"
          initialSizes={[28, 46, 26]}
          minSizesPx={[220, 240, 220]}
          storageKey="workbench:body"
        >
          <aside className="workbench__left">{left}</aside>
          <main className="workbench__main">{main}</main>
          <aside className="workbench__right">{right}</aside>
        </ResizableSplit>

        <section className="workbench__bottom">{bottom}</section>
      </ResizableSplit>
    </div>
  );
}
