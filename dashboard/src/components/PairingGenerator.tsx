'use client';

/**
 * Generates the pairing code and shows it as text plus a QR image.
 *
 * The code alone does not create a connection: the other person redeems it,
 * and then the guardian confirms the specific person who did. Both halves are
 * shown here so the guardian is not left wondering why nothing happened after
 * reading out a code.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { pairingApi } from '@/lib/endpoints';
import { ApiError } from '@/lib/api';

interface Props {
  onChanged: () => void;
}

export function PairingGenerator({ onChanged }: Props): React.JSX.Element {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const invite = await pairingApi.createInvite();
      setCode(invite.code);
      setExpiresAt(invite.expiresAt);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, [onChanged]);

  // Render the QR only after the canvas exists, so a fast response does not
  // race the first paint.
  useEffect(() => {
    if (!code || !canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, `guardian://pair?code=${code}`, {
      width: 176,
      margin: 1,
      color: { dark: '#0F1115', light: '#FFFFFF' },
    });
  }, [code]);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () =>
      setRemaining(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const expired = Boolean(expiresAt) && remaining <= 0;

  return (
    <section className="rounded-xl border border-line bg-ink-raised p-5">
      <h2 className="text-lg font-semibold">Connect a device</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Generate a code and give it to the person you want to connect with. They enter or scan it
        on their phone, then you confirm below. Both steps are required.
      </p>

      {!code ? (
        <button
          onClick={() => void generate()}
          disabled={busy}
          className="mt-4 rounded-lg bg-accent px-4 py-2.5 font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Generating…' : 'Generate code'}
        </button>
      ) : (
        <div className="mt-4 flex flex-wrap items-start gap-6">
          <div className="rounded-lg bg-white p-2">
            <canvas ref={canvasRef} aria-label={`QR code for pairing code ${code}`} />
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Pairing code</p>
            <p className="font-mono text-3xl tracking-[0.3em]" aria-live="polite">
              {code}
            </p>
            <p className={`mt-2 text-sm ${expired ? 'text-live' : 'text-muted'}`}>
              {expired
                ? 'Expired — generate a new one.'
                : `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}
            </p>
            <button
              onClick={() => void generate()}
              disabled={busy}
              className="mt-3 rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-40"
            >
              Generate a new code
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-live">
          {error}
        </p>
      )}
    </section>
  );
}
