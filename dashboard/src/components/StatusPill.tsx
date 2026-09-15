import { channelStatus, type ChannelStatus } from '@/lib/channel-status';

export { channelStatus };
export type { ChannelStatus };

const STYLES: Record<ChannelStatus, { label: string; className: string }> = {
  ON: { label: 'Available', className: 'bg-shield/15 text-shield border-shield/40' },
  OFF: { label: 'Switched off', className: 'bg-line/40 text-muted border-line' },
  SHIELDED: { label: 'Privacy Shield on', className: 'bg-line/40 text-muted border-line' },
  LOCKED: { label: 'Locked on', className: 'bg-locked/15 text-locked border-locked/40' },
  INACTIVE: { label: 'Not connected', className: 'bg-line/40 text-muted border-line' },
};

export function StatusPill({ status }: { status: ChannelStatus }): React.JSX.Element {
  const s = STYLES[status];
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  );
}
