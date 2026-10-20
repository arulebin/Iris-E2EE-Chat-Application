import type { ReactNode } from "react";

// Centers the app in a phone-shaped frame on desktop, full-screen on mobile.
// Uses a fixed height (all of #root on mobile — #root is already inset by the
// safe area, see index.css — 90vh on desktop) so children's flex-1 and
// overflow-y-auto work correctly. `relative` so absolutely-positioned
// elements (FAB, modals) stay within the frame.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full bg-bg flex items-center justify-center sm:p-4">
      <div className="relative w-full sm:max-w-md h-full sm:h-[90vh] sm:max-h-225 bg-bg sm:rounded-3xl sm:shadow-xl dark:sm:ring-1 dark:sm:ring-muted-soft flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
