// One app, framed at a real device size.
//
// The app runs in an iframe at the device's actual pixel width, scaled down
// to fit the window. That is how a device emulator works, and it is the only
// way the app's own media queries and viewport units mean anything: inside
// the frame it genuinely believes it is 360px wide.
//
// Full bleed, outside the app shell. A phone frame needs the whole viewport,
// and the dashboard's nav around a drawing of a phone is chrome around
// chrome.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  DEFAULT_DEVICE,
  DEVICE_SIZES,
  prototypeById,
  type DeviceSize,
} from '@/platform/prototypes/registry';
import { FIXTURES_PARAM } from '@/platform/prototypes/fixtures';
import { NotFoundView } from '@/platform/routing/NotFoundView';
import { routes } from '@/types/routes';

// Grouped so the platform is readable off the page. Ungrouped, a row of
// device names reads as an Apple only list unless you already know which
// company makes a Pixel.
const GROUPS = DEVICE_SIZES.reduce<Array<{ platform: string; devices: DeviceSize[] }>>(
  (acc, device) => {
    const group = acc.find((g) => g.platform === device.platform);
    if (group) group.devices.push(device);
    else acc.push({ platform: device.platform, devices: [device] });
    return acc;
  },
  []
);

const SHELL_CLASS: Record<DeviceSize['shell'], string> = {
  // The corner radius is what reads as "which phone is this" at a glance. An
  // iPhone is much rounder than a Galaxy or a Pixel.
  ios: 'rounded-[34px] border-[11px] border-[#1b2431]',
  android: 'rounded-[20px] border-[9px] border-[#1b2431]',
  tablet: 'rounded-[18px] border-[12px] border-[#1b2431]',
  // A laptop gets a plain window: drawing a bezel around a 1280px viewport
  // would misrepresent what is being shown.
  flat: 'rounded-[10px] border border-hairline',
};

export default function PrototypePreviewPage() {
  const { appId } = useParams<{ appId: string }>();
  const app = appId ? prototypeById(appId) : undefined;

  const [device, setDevice] = useState<DeviceSize>(DEFAULT_DEVICE);
  const [offline, setOffline] = useState(false);
  const [scale, setScale] = useState(1);
  const [shell, setShell] = useState({ width: 0, height: 0 });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<HTMLDivElement>(null);

  // Scaled to fit whatever room the window leaves, never scaled up: a phone
  // blown up past life size would flatter a layout that is actually tight.
  //
  // The shell is measured rather than computed, because the bezel sits
  // outside the device's own size and differs per shell. offsetWidth is
  // layout size and ignores the transform, so reading it cannot feed the
  // scale back into itself.
  useEffect(() => {
    const stage = stageRef.current;
    const box = deviceRef.current;
    if (!stage || !box) return;
    const fit = () => {
      // The content box, not the border box: the stage is padded, and
      // measuring across the padding claims room the device cannot use.
      const style = getComputedStyle(stage);
      const room = {
        width: stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      };
      const size = { width: box.offsetWidth, height: box.offsetHeight };
      const next = Math.min(1, room.width / size.width, room.height / size.height);
      setShell(size);
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [device]);

  // Reaches into the running app rather than reloading it, so a queue built
  // up while offline is still there when signal comes back. Changing device
  // only resizes the frame and the app reflows into it, which is the more
  // useful behaviour anyway: switching from a phone to a laptop keeps
  // whatever is queued and whichever screen is open, so two layouts can be
  // compared rather than re-created.
  const applyOffline = useCallback((next: boolean) => {
    setOffline(next);
    frameRef.current?.contentWindow?.__fieldPreview?.setOffline(next);
  }, []);

  if (!app) return <NotFoundView />;

  const src = `${app.target}?${FIXTURES_PARAM}=1`;

  return (
    <div className="fixed inset-0 grid grid-rows-[auto_minmax(0,1fr)_auto] bg-surface-sunken text-[var(--color-ink)]">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-hairline bg-surface-raised px-4 py-2.5">
        <div className="mr-auto flex flex-col leading-tight">
          <Link
            to={routes.prototypes()}
            className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-[var(--color-ink-soft)] hover:text-[var(--color-accent)]"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" /> Prototypes
          </Link>
          <span className="text-base font-semibold">{app.name}</span>
          <span className="text-[11px] uppercase tracking-wider text-[var(--color-ink-soft)]">
            Preview, stand-in data
          </span>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          {GROUPS.map((group) => (
            <div key={group.platform} className="flex min-w-0 items-center gap-2">
              {/* Not uppercased: it would render iOS as IOS, which Apple
                  spells that way nowhere and which reads as a typo. */}
              <span className="shrink-0 text-[11px] font-semibold tracking-wide text-[var(--color-ink-soft)]">
                {group.platform}
              </span>
              <div
                className="flex min-w-0 overflow-x-auto rounded-lg border border-hairline"
                role="group"
                aria-label={`${group.platform} screen sizes`}
              >
                {group.devices.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={d.id === device.id}
                    title={`${d.detail}, ${d.width} by ${d.height}`}
                    onClick={() => setDevice(d)}
                    className={`shrink-0 border-r border-hairline px-3 py-1.5 text-[13px] last:border-r-0 transition ${
                      d.id === device.id
                        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                        : 'hover:bg-fill-subtle'
                    }`}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          aria-pressed={offline}
          onClick={() => applyOffline(!offline)}
          className={`shrink-0 rounded-lg border border-hairline px-3.5 py-1.5 text-[13px] font-medium transition ${
            offline ? 'bg-[var(--color-warning)] text-[var(--color-surface-base)]' : 'hover:bg-fill-subtle'
          }`}
        >
          {offline ? 'Back online' : 'Go offline'}
        </button>
      </header>

      <div ref={stageRef} className="grid min-h-0 place-items-center overflow-hidden p-6">
        {/* A wrapper sized to the scaled result, with the device scaled from
            its top left inside it. Centring the device and scaling about its
            middle does not work: a grid item taller than its area is start
            aligned rather than centred, so a phone that needed shrinking
            hangs off the bottom. Giving the layout box the same size as the
            drawn box means nothing overflows and centring is just centring. */}
        <div
          className="relative shrink-0"
          style={{ width: shell.width * scale || undefined, height: shell.height * scale || undefined }}
        >
          <div
            ref={deviceRef}
            className={`absolute left-0 top-0 box-content overflow-hidden bg-surface-base shadow-2xl ${SHELL_CLASS[device.shell]}`}
            style={{ width: device.width, height: device.height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          >
            <iframe
              ref={frameRef}
              src={src}
              title={`${app.name} at ${device.width} by ${device.height}`}
              className="block h-full w-full border-0"
            />
          </div>
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-hairline bg-surface-raised px-4 py-2 text-xs tabular-nums text-[var(--color-ink-soft)]">
        <span>
          {device.platform} · {device.name} · {device.width}&times;{device.height}
          {scale < 1 && ` · shown at ${Math.round(scale * 100)}%`}
        </span>
        <span className="mr-auto">
          Go offline, then log a knock: it saves on the phone and sends itself when signal returns.
        </span>
        <span className="font-mono text-[11px]">{app.source}</span>
      </footer>
    </div>
  );
}
