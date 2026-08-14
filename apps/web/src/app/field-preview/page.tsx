'use client';

// The test site: the field app at whatever size you want to look at it.
//
// Built for the loop between now and the store release. Push a change, the
// Pages build picks it up, reload this and see it on a phone, a tablet and a
// laptop without owning three of them. The build stamp in the corner is how
// you know you are looking at your change rather than a cached one.
//
// The app runs in an iframe at the device's real pixel width, scaled down to
// fit the window. That is how a device emulator works and it is the only way
// the app's own media queries and viewport units mean anything: the app
// genuinely believes it is 393px wide.

import { useCallback, useEffect, useRef, useState } from 'react';
import deviceList from '@letlois/field-ui/devices.json';
import './preview.css';

interface Device {
  id: string;
  name: string;
  platform: string;
  detail: string;
  width: number;
  height: number;
  // Phones get a bezel, and an Android one is squarer than an iPhone. A
  // laptop gets a plain window: drawing a phone shell around a 1280px
  // viewport would be a lie about what is being shown.
  shell: 'ios' | 'android' | 'tablet' | 'flat';
}

// Shared with the single file preview so the two cannot disagree about what
// the app looks like. See the note at the top of devices.json.
const DEVICES = deviceList.devices as Device[];

// Grouped so the platform is readable off the page. Ungrouped, a row of
// device names reads as an Apple only list unless you already know which
// company makes a Pixel.
const GROUPS: Array<{ platform: string; devices: Device[] }> = [];
for (const device of DEVICES) {
  const group = GROUPS.find((g) => g.platform === device.platform);
  if (group) group.devices.push(device);
  else GROUPS.push({ platform: device.platform, devices: [device] });
}

export default function FieldPreviewPage() {
  const [device, setDevice] = useState<Device>(DEVICES[1]!);
  const [offline, setOffline] = useState(false);
  const [scale, setScale] = useState(1);
  // The shell's unscaled size, including the bezel. Held so the wrapper can
  // be given the scaled size as its layout size, see the note on .fp-fit.
  const [shell, setShell] = useState({ width: 0, height: 0 });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<HTMLDivElement>(null);

  // Scaled to fit whatever room the window leaves, never scaled up: a phone
  // blown up past life size would flatter a layout that is actually tight.
  //
  // The shell is measured rather than computed, because the bezel sits
  // outside the device's own size and differs per shell. offsetWidth is
  // layout size and ignores the transform, so reading it here cannot feed
  // the scale back into itself.
  useEffect(() => {
    const stage = stageRef.current;
    const shell = deviceRef.current;
    if (!stage || !shell) return;
    const fit = () => {
      // The content box, not the border box: the stage is padded, and
      // measuring across the padding claims room the device cannot use.
      const style = getComputedStyle(stage);
      const room = {
        width: stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      };
      const size = { width: shell.offsetWidth, height: shell.offsetHeight };
      const next = Math.min(1, room.width / size.width, room.height / size.height);
      setShell(size);
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [device]);

  // Both controls reach into the running app rather than reloading it.
  //
  // The frame is loaded exactly once and never navigated again, which is not
  // a preference: a Next static export page mounts once per browsing
  // context, and a second load of the same route in the same frame leaves an
  // empty document. Changing device only resizes the frame, and the app
  // reflows into it, which is the more useful behaviour anyway. Switching
  // from a phone to a laptop keeps whatever is queued and whichever screen
  // is open, so a layout can be compared rather than re-created.
  const applyOffline = useCallback((next: boolean) => {
    setOffline(next);
    frameRef.current?.contentWindow?.__fieldDemo?.setOffline(next);
  }, []);

  const restart = useCallback(() => {
    frameRef.current?.contentWindow?.__fieldDemo?.restart();
    setOffline(false);
  }, []);

  const build = process.env.NEXT_PUBLIC_BUILD_SHA ?? 'dev';
  const branch = process.env.NEXT_PUBLIC_BUILD_BRANCH ?? 'local';

  return (
    <div className="fp">
      <header className="fp-bar">
        <div className="fp-identity">
          <a className="fp-back" href="/prototypes">
            Prototypes
          </a>
          <span className="fp-title">All Star Field</span>
          <span className="fp-sub">test site, fixture data</span>
        </div>

        <div className="fp-platforms">
          {GROUPS.map((group) => (
            <div className="fp-platform" key={group.platform}>
              <span className="fp-platform-label">{group.platform}</span>
              <div className="fp-devices" role="group" aria-label={`${group.platform} screen sizes`}>
                {group.devices.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={d.id === device.id ? 'active' : ''}
                    aria-pressed={d.id === device.id}
                    title={`${d.detail}, ${d.width} by ${d.height}`}
                    onClick={() => setDevice(d)}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="fp-actions">
          <button
            type="button"
            className={offline ? 'active' : ''}
            aria-pressed={offline}
            onClick={() => applyOffline(!offline)}
          >
            {offline ? 'Back online' : 'Go offline'}
          </button>
          <button type="button" onClick={restart}>
            Restart
          </button>
          <a href="/field-demo" target="_blank" rel="noreferrer">
            Open full window
          </a>
        </div>
      </header>

      <div className="fp-stage" ref={stageRef}>
        {/* A wrapper sized to the scaled result, with the device scaled from
            its top left corner inside it. The obvious version, centring the
            device and scaling about its middle, breaks: a grid item taller
            than its area gets start aligned rather than centred, so a phone
            that needed shrinking hung off the bottom of the stage. Giving
            the layout box the same size as the visual box means nothing ever
            overflows and centring is just centring. */}
        <div
          className="fp-fit"
          style={{ width: shell.width * scale || undefined, height: shell.height * scale || undefined }}
        >
          <div
            ref={deviceRef}
            className={`fp-device fp-device-${device.shell}`}
            style={{
              width: device.width,
              height: device.height,
              transform: `scale(${scale})`,
            }}
          >
            {/* Loaded once, as an attribute, and never navigated again.
                See the note on the controls above, and the one on the
                gallery link that opens this page. */}
            <iframe
              ref={frameRef}
              src="/field-demo"
              title={`All Star Field at ${device.width} by ${device.height}`}
            />
          </div>
        </div>
      </div>

      <footer className="fp-foot">
        <span>
          {device.platform} · {device.name} · {device.width}&times;{device.height}
          {scale < 1 && ` · shown at ${Math.round(scale * 100)}%`}
        </span>
        <span className="fp-hint">
          Go offline, then log a knock: it saves on the phone and sends itself when signal returns.
        </span>
        <span className="fp-build">
          {branch} · {build}
        </span>
      </footer>
    </div>
  );
}
