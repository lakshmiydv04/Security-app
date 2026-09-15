import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';

export const metadata: Metadata = {
  title: 'Guardian Dashboard',
  description: 'Consent-driven family safety monitoring',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en">
      {/*
        suppressHydrationWarning is on <body> specifically because browser
        extensions inject attributes there before React hydrates - ColorZilla
        adds cz-shortcut-listen="true", Grammarly adds data-gr-* and so on.
        The server cannot know about them, so the markup legitimately differs
        and React reports a mismatch that is nothing to do with this app.

        It suppresses only attribute differences on this one element, one level
        deep. Real hydration bugs anywhere inside the tree are still reported,
        which is why it belongs here and nowhere else.
      */}
      <body suppressHydrationWarning>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
