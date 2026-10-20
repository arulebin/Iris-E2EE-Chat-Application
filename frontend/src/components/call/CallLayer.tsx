import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { CallController } from "../../lib/call/useCall";
import { dismissZone, overDismiss, snapToCorner, snapToEdge, type Point, type Size } from "../../lib/call/snap";
import { formatDuration } from "../../lib/call/signals";
import type { Quality } from "../../lib/call/quality";
import type { UserProfile } from "../../types";
import { Avatar } from "../Avatar";
import { CallNoticeBanner } from "../CallNoticeBanner";
import { useDraggable, useSafeInsets } from "./useDraggable";
import {
  CamIcon, ChevronDownIcon, FlipIcon, LockIcon, MicIcon, PhoneIcon, PipIcon, SpeakerIcon, XIcon,
} from "./callIcons";

// Everything call-related that floats over the app: the incoming-call screen,
// the full-screen call, the minimized draggable call window, the "On call" pill
// shown when that window is dragged away, and the remote-audio sink.

type Props = {
  call: CallController;
  profileOf?: (username: string) => UserProfile | undefined;
};

const SELF_TILE: Size = { w: 104, h: 156 };
const MINI_VIDEO: Size = { w: 116, h: 172 };
const MINI_VOICE: Size = { w: 104, h: 124 };
const CONTROLS_HIDE_MS = 4000;

export function CallLayer({ call, profileOf }: Props) {
  const { state } = call;
  const peer = state.kind === "outgoing" ? state.to : state.kind === "active" ? state.peer : state.kind === "incoming" ? state.from : "";
  const profile = peer ? profileOf?.(peer) : undefined;
  const label = profile?.preferredName || peer;

  return (
    <>
      {/* Single, persistent remote-audio sink: audio keeps playing when minimized or dismissed. */}
      <AudioSink attach={call.attachAudioSink} />
      {call.notice && <CallNoticeBanner message={call.notice} />}

      {state.kind === "incoming" && (
        <IncomingScreen
          name={label}
          peer={peer}
          avatarUrl={profile?.avatarUrl}
          video={state.mode === "video"}
          onAccept={() => void call.accept(true)}
          onAcceptVoice={() => void call.accept(false)}
          onDecline={call.reject}
        />
      )}

      {(state.kind === "outgoing" || state.kind === "active") && (
        call.pipActive ? (
          <PipView call={call} name={label} peer={peer} avatarUrl={profile?.avatarUrl} />
        ) : !call.minimized ? (
          <CallScreen call={call} name={label} peer={peer} avatarUrl={profile?.avatarUrl} />
        ) : !call.previewHidden ? (
          <MiniWindow call={call} name={label} peer={peer} avatarUrl={profile?.avatarUrl} />
        ) : (
          <CallPill call={call} name={label} />
        )
      )}
    </>
  );
}

// ── shared bits ─────────────────────────────────────────────────────────────

function AudioSink({ attach }: { attach: (el: HTMLAudioElement | null) => void }) {
  return <audio ref={attach} autoPlay className="hidden" />;
}

function VideoView({ stream, mirror, muted = true, className, videoRef }: {
  stream: MediaStream | null;
  mirror?: boolean;
  muted?: boolean;
  className?: string;
  videoRef?: (el: HTMLVideoElement | null) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={(el) => { ref.current = el; videoRef?.(el); }}
      autoPlay
      playsInline
      // Remote audio plays through the app-level sink, never through <video>.
      muted={muted}
      className={className}
      style={mirror ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}

const liveVideo = (s: MediaStream | null) =>
  !!s?.getVideoTracks().some((t) => t.readyState === "live" && !t.muted);

function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, (now - startedAt) / 1000);
}

function statusText(call: CallController): string {
  const s = call.state;
  if (s.kind === "outgoing") return "Ringing…";
  if (call.reconnecting) return "Reconnecting…";
  return "";
}

function QualityBars({ quality }: { quality: Quality }) {
  if (quality === "unknown") return null;
  const level = quality === "good" ? 3 : quality === "fair" ? 2 : 1;
  const color = quality === "good" ? "bg-emerald-400" : quality === "fair" ? "bg-amber-400" : "bg-rose-500";
  return (
    <span className="inline-flex items-end gap-0.5 h-3" role="img" aria-label={`Connection ${quality}`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`w-1 rounded-sm ${i <= level ? color : "bg-white/25"}`} style={{ height: `${i * 33}%` }} />
      ))}
    </span>
  );
}

function RoundButton({ label, onClick, active, danger, large, children }: {
  label: string; onClick: () => void; active?: boolean; danger?: boolean; large?: boolean; children: ReactNode;
}) {
  const tone = danger
    ? "bg-rose-600 hover:bg-rose-500 text-white"
    : active
      ? "bg-white text-black"
      : "bg-white/15 hover:bg-white/25 text-white backdrop-blur";
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={label}
      aria-pressed={danger ? undefined : !!active}
      className={`${large ? "w-16 h-16" : "w-14 h-14"} rounded-full flex items-center justify-center transition active:scale-95 ${tone}`}
    >
      {children}
    </button>
  );
}

// ── incoming ────────────────────────────────────────────────────────────────

function IncomingScreen({ name, peer, avatarUrl, video, onAccept, onAcceptVoice, onDecline }: {
  name: string; peer: string; avatarUrl?: string; video: boolean;
  onAccept: () => void; onAcceptVoice: () => void; onDecline: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-between text-white"
      style={{
        background: "radial-gradient(120% 80% at 50% 20%, #2a2766 0%, #0b0d12 70%)",
        paddingTop: "max(env(safe-area-inset-top), 24px)",
        paddingBottom: "max(env(safe-area-inset-bottom), 24px)",
      }}
      role="dialog"
      aria-label={`Incoming ${video ? "video" : "voice"} call from ${name}`}
    >
      <div className="flex flex-col items-center flex-1 justify-center gap-5 px-6">
        <div className="relative">
          <span className="absolute inset-0 rounded-full bg-primary/40 animate-ping" style={{ animationDuration: "1.8s" }} />
          <Avatar name={peer} avatarUrl={avatarUrl} size="xl" />
        </div>
        <div className="text-center">
          <p className="text-3xl font-semibold tracking-tight">{name}</p>
          <p className="mt-2 text-white/60 text-sm">Iris {video ? "video" : "voice"} call</p>
        </div>
        <p className="flex items-center gap-1.5 text-white/40 text-xs"><LockIcon /> End-to-end encrypted</p>
      </div>

      <div className="w-full max-w-sm px-10 pb-6">
        <div className="flex items-center justify-between">
          <div className="flex flex-col items-center gap-2">
            <RoundButton label="Decline" onClick={onDecline} danger large><PhoneIcon hangup /></RoundButton>
            <span className="text-xs text-white/70">Decline</span>
          </div>
          {video && (
            <div className="flex flex-col items-center gap-2">
              <RoundButton label="Answer without video" onClick={onAcceptVoice}><CamIcon off /></RoundButton>
              <span className="text-xs text-white/70">Voice only</span>
            </div>
          )}
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={onAccept}
              aria-label={video ? "Answer with video" : "Answer"}
              className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white flex items-center justify-center animate-bounce active:scale-95"
              style={{ animationDuration: "1.4s" }}
            >
              {video ? <CamIcon /> : <PhoneIcon />}
            </button>
            <span className="text-xs text-white/70">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── full screen ─────────────────────────────────────────────────────────────

function CallScreen({ call, name, peer, avatarUrl }: { call: CallController; name: string; peer: string; avatarUrl?: string }) {
  const s = call.state;
  const insets = useSafeInsets();
  const [swapped, setSwapped] = useState(false);
  const [controlsVisibleRaw, setControlsVisible] = useState(true);
  const [pokes, setPokes] = useState(0);
  const remoteVideoEl = useRef<HTMLVideoElement | null>(null);

  const startedAt = s.kind === "active" ? s.startedAt : null;
  const elapsed = useElapsed(startedAt);
  const videoUi = s.kind !== "idle" && "mode" in s && s.mode === "video";
  const remoteHasVideo = liveVideo(call.remoteStream) && !call.remote.cameraOff;
  const localHasVideo = liveVideo(call.localStream) && !call.cameraOff;
  const mainIsLocal = swapped && localHasVideo && remoteHasVideo;
  const mainHasVideo = mainIsLocal ? localHasVideo : remoteHasVideo;
  const autoHide = videoUi && s.kind === "active" && mainHasVideo && !call.reconnecting;

  // Controls stay up for voice calls and while connecting; in a live video call
  // they fade after a few seconds without interaction, and any touch brings them back.
  const controlsVisible = !autoHide || controlsVisibleRaw;
  const poke = useCallback(() => {
    setControlsVisible(true);
    setPokes((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!autoHide || !controlsVisibleRaw) return;
    const t = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
    return () => clearTimeout(t);
  }, [autoHide, controlsVisibleRaw, pokes]);

  const selfDrag = useDraggable({
    size: SELF_TILE,
    insets: { ...insets, top: insets.top + 64, bottom: insets.bottom + (controlsVisible ? 120 : 16) },
    initial: (vp) => ({ x: vp.w - SELF_TILE.w - 12, y: insets.top + 76 }),
    settle: (p, v, vp) => snapToCorner(p, v, SELF_TILE, vp, { ...insets, top: insets.top + 64, bottom: insets.bottom + 120 }),
    onTap: () => setSwapped((x) => !x),
  });

  const webPip = !call.speakerSupported && typeof document !== "undefined" && document.pictureInPictureEnabled && remoteHasVideo;
  const status = statusText(call);

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0b0d12] text-white select-none overflow-hidden"
      onPointerDown={poke}
      onClick={() => (autoHide ? setControlsVisible((v) => !v) : poke())}
    >
      {/* Main stage */}
      {mainHasVideo ? (
        <VideoView
          stream={mainIsLocal ? call.localStream : call.remoteStream}
          mirror={mainIsLocal && call.facing === "user"}
          className="absolute inset-0 w-full h-full object-cover"
          videoRef={(el) => { if (!mainIsLocal) remoteVideoEl.current = el; }}
        />
      ) : (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-5"
          style={{ background: "radial-gradient(120% 80% at 50% 25%, #23205a 0%, #0b0d12 70%)" }}
        >
          <div className="relative">
            {s.kind === "outgoing" && <span className="absolute inset-0 rounded-full bg-primary/35 animate-ping" style={{ animationDuration: "1.8s" }} />}
            <Avatar name={peer} avatarUrl={avatarUrl} size="xl" />
          </div>
          {videoUi && s.kind === "active" && call.remote.cameraOff && (
            <p className="text-white/60 text-sm flex items-center gap-1.5"><CamIcon off className="w-4 h-4" /> Camera off</p>
          )}
        </div>
      )}

      {/* Top bar */}
      <div
        className={`absolute inset-x-0 top-0 px-3 pb-6 flex items-start gap-2 bg-gradient-to-b from-black/60 to-transparent transition-opacity duration-300 ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        style={{ paddingTop: insets.top + 10 }}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); call.setMinimized(true); }}
          aria-label="Minimize call"
          className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20"
        >
          <ChevronDownIcon />
        </button>
        <div className="flex-1 min-w-0 text-center">
          <p className="font-semibold text-lg truncate flex items-center justify-center gap-1.5">
            {name}
            {call.remote.muted && s.kind === "active" && <span aria-label={`${name} is muted`}><MicIcon off className="w-4 h-4 text-rose-300" /></span>}
          </p>
          <p className="text-xs text-white/70 flex items-center justify-center gap-2">
            {status ? (
              <span className={call.reconnecting ? "text-amber-300" : ""}>{status}</span>
            ) : (
              <span className="tabular-nums">{formatDuration(elapsed)}</span>
            )}
            <QualityBars quality={call.quality} />
            <span className="flex items-center gap-1 text-white/50"><LockIcon className="w-3 h-3" /> Encrypted</span>
          </p>
        </div>
        {webPip ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void remoteVideoEl.current?.requestPictureInPicture().catch(() => {}); }}
            aria-label="Pop out video"
            className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20"
          >
            <PipIcon />
          </button>
        ) : <span className="w-10" />}
      </div>

      {/* Self view (draggable, snaps to corners, tap to swap) */}
      {localHasVideo && remoteHasVideo && (
        <div
          {...selfDrag.handlers}
          style={selfDrag.style}
          className="z-10 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/20 bg-black cursor-grab active:cursor-grabbing"
          aria-label="Your video — drag to move, tap to swap"
          role="button"
          onClick={(e) => e.stopPropagation()}
        >
          <VideoView
            stream={mainIsLocal ? call.remoteStream : call.localStream}
            mirror={!mainIsLocal && call.facing === "user"}
            className="w-full h-full object-cover pointer-events-none"
          />
        </div>
      )}
      {/* Before the peer's video arrives, show our camera full-bleed under the avatar card */}
      {localHasVideo && !remoteHasVideo && (
        <div className="absolute right-3 z-10 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/20" style={{ top: insets.top + 76, width: SELF_TILE.w, height: SELF_TILE.h }}>
          <VideoView stream={call.localStream} mirror={call.facing === "user"} className="w-full h-full object-cover" />
        </div>
      )}

      {/* Controls */}
      <div
        className={`absolute inset-x-0 bottom-0 pt-10 bg-gradient-to-t from-black/70 to-transparent transition-all duration-300 ${controlsVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6 pointer-events-none"}`}
        style={{ paddingBottom: insets.bottom + 22 }}
      >
        <div className="flex items-center justify-center gap-4 px-4">
          {call.speakerSupported && (
            <RoundButton label={call.speakerOn ? "Use earpiece" : "Use speaker"} onClick={call.toggleSpeaker} active={call.speakerOn}>
              <SpeakerIcon on={call.speakerOn} />
            </RoundButton>
          )}
          <RoundButton
            label={localHasVideo ? "Turn camera off" : videoUi ? "Turn camera on" : "Switch to video"}
            onClick={() => void call.toggleCamera()}
            active={!localHasVideo}
          >
            <CamIcon off={!localHasVideo} />
          </RoundButton>
          {localHasVideo && (
            <RoundButton label="Flip camera" onClick={() => void call.flipCamera()}>
              <FlipIcon />
            </RoundButton>
          )}
          <RoundButton label={call.muted ? "Unmute" : "Mute"} onClick={call.toggleMute} active={call.muted}>
            <MicIcon off={call.muted} />
          </RoundButton>
          <RoundButton label={s.kind === "outgoing" ? "Cancel call" : "End call"} onClick={call.hangUp} danger large>
            <PhoneIcon hangup />
          </RoundButton>
        </div>
      </div>
    </div>
  );
}

// ── Android system PiP: just the remote picture ─────────────────────────────

function PipView({ call, name, peer, avatarUrl }: { call: CallController; name: string; peer: string; avatarUrl?: string }) {
  const remoteHasVideo = liveVideo(call.remoteStream) && !call.remote.cameraOff;
  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
      {remoteHasVideo ? (
        <VideoView stream={call.remoteStream} className="w-full h-full object-cover" />
      ) : (
        <div className="flex flex-col items-center gap-2 text-white">
          <Avatar name={peer} avatarUrl={avatarUrl} size="lg" />
          <span className="text-xs truncate max-w-[90%]">{name}</span>
        </div>
      )}
    </div>
  );
}

// ── minimized: draggable window with drag-to-dismiss ────────────────────────

function MiniWindow({ call, name, peer, avatarUrl }: { call: CallController; name: string; peer: string; avatarUrl?: string }) {
  const s = call.state;
  const insets = useSafeInsets();
  const remoteHasVideo = liveVideo(call.remoteStream) && !call.remote.cameraOff;
  const size = remoteHasVideo ? MINI_VIDEO : MINI_VOICE;
  const [overTarget, setOverTarget] = useState(false);
  const elapsed = useElapsed(s.kind === "active" ? s.startedAt : null);

  const zoneFor = useCallback((vp: Size) => dismissZone(vp, insets), [insets]);
  const drag = useDraggable({
    size,
    insets: { ...insets, top: insets.top + 8, bottom: insets.bottom + 8 },
    initial: (vp) => ({ x: vp.w - size.w - 12, y: insets.top + 80 }),
    settle: (p, v, vp) => snapToEdge(p, v, size, vp, { ...insets, top: insets.top + 8, bottom: insets.bottom + 72 }),
    onTap: () => call.setMinimized(false),
    onMove: (p: Point) => setOverTarget(overDismiss(p, size, zoneFor({ w: window.innerWidth, h: window.innerHeight }))),
    onDrop: (p: Point) => {
      const hit = overDismiss(p, size, zoneFor({ w: window.innerWidth, h: window.innerHeight }));
      setOverTarget(false);
      if (hit) call.setPreviewHidden(true);
      return hit;
    },
  });
  const zone = zoneFor(drag.viewport);

  return (
    <>
      {drag.dragging && (
        <div
          className="fixed z-[55] pointer-events-none flex items-center justify-center rounded-full text-white transition-all duration-200"
          style={{
            left: zone.cx - zone.r,
            top: zone.cy - zone.r,
            width: zone.r * 2,
            height: zone.r * 2,
            background: overTarget ? "rgba(225,29,72,0.9)" : "rgba(15,17,23,0.75)",
            transform: `scale(${overTarget ? 1.15 : 1})`,
            boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
          }}
          aria-hidden
        >
          <XIcon className="w-7 h-7" />
        </div>
      )}
      <div
        {...drag.handlers}
        style={{ ...drag.style, opacity: overTarget ? 0.6 : 1 }}
        className="z-[56] rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/15 bg-[#11131a] text-white cursor-grab active:cursor-grabbing"
        role="button"
        aria-label={`Call with ${name} — tap to return, drag to the bottom to hide`}
      >
        {remoteHasVideo ? (
          <VideoView stream={call.remoteStream} className="w-full h-full object-cover pointer-events-none" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 pointer-events-none">
            <Avatar name={peer} avatarUrl={avatarUrl} size="lg" />
            <span className="text-[11px] tabular-nums text-white/80">
              {s.kind === "outgoing" ? "Ringing…" : call.reconnecting ? "Reconnecting…" : formatDuration(elapsed)}
            </span>
          </div>
        )}
        {call.muted && (
          <span className="absolute bottom-1.5 left-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center pointer-events-none">
            <MicIcon off className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    </>
  );
}

// ── dismissed window: compact "On call" pill ────────────────────────────────

function CallPill({ call, name }: { call: CallController; name: string }) {
  const s = call.state;
  const elapsed = useElapsed(s.kind === "active" ? s.startedAt : null);
  return (
    <button
      type="button"
      onClick={() => { call.setPreviewHidden(false); call.setMinimized(false); }}
      className="fixed left-1/2 -translate-x-1/2 z-[56] flex items-center gap-2 pl-3 pr-4 py-2 rounded-full bg-emerald-600 text-white text-sm font-medium shadow-lg active:scale-95 transition"
      style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
      aria-label={`Return to call with ${name}`}
    >
      <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
      <span className="truncate max-w-[45vw]">{name}</span>
      <span className="tabular-nums text-white/85">
        · {s.kind === "outgoing" ? "Ringing…" : call.reconnecting ? "Reconnecting…" : formatDuration(elapsed)}
      </span>
      {call.muted && <MicIcon off className="w-4 h-4" />}
    </button>
  );
}
