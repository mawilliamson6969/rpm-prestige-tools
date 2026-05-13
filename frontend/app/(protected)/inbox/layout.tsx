"use client";

import type { ReactNode } from "react";
import InboxShell from "../../../components/inbox/shell/InboxShell";
import { InboxShellProvider } from "../../../components/inbox/shell/InboxShellContext";
import { NotificationProvider } from "../../../hooks/inbox/useNotificationCenter";
import { ToastProvider } from "../../../hooks/inbox/useToast";
import ToastContainer from "../../../components/inbox/ToastContainer";

export default function InboxRootLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <NotificationProvider>
        <InboxShellProvider>
          <InboxShell>{children}</InboxShell>
          <ToastContainer />
        </InboxShellProvider>
      </NotificationProvider>
    </ToastProvider>
  );
}
