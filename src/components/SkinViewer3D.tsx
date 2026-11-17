import { useEffect, useRef, useState } from 'react';
import { SkinViewer, IdleAnimation, WalkingAnimation } from 'skinview3d';
import { RotateCcw, Play, Pause, User, RefreshCw } from 'lucide-react';
import type { SkinModel } from '../types/awards';

interface SkinViewer3DProps {
  skinUrl: string | null;
  skinModel: SkinModel;
  playerName: string;
  height?: number;
  className?: string;
}

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const rendererStr = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererStr);
  } catch {
    return true;
  }
}

export function SkinViewer3D({
  skinUrl,
  skinModel,
  playerName,
  height = 340,
  className = '',
}: SkinViewer3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<SkinViewer | null>(null);

  const [animMode, setAnimMode] = useState<'idle' | 'walk' | 'paused'>('idle');
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const applyAnimation = (viewer: SkinViewer, mode: 'idle' | 'walk' | 'paused') => {
    if (mode === 'paused') {
      viewer.animation = null;
      return;
    }

    if (mode === 'walk') {
      const walk = new WalkingAnimation();
      walk.speed = 0.85;
      viewer.animation = walk;
      return;
    }

    const idle = new IdleAnimation();
    idle.speed = 0.9;
    // Add subtle natural standing/chatting look-around & breathing motion
    idle.addAnimation((player, progress) => {
      player.skin.head.rotation.y = Math.sin(progress * 0.8) * 0.16;
      player.skin.head.rotation.x = Math.sin(progress * 0.5) * 0.05;
      player.rotation.y = Math.sin(progress * 0.35) * 0.08;
    });
    viewer.animation = idle;
  };

  useEffect(() => {
    if (!skinUrl || !canvasRef.current || !containerRef.current) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isSoftwareGl = detectSoftwareWebGL();
    const width = containerRef.current.clientWidth || 320;

    setLoading(true);
    setLoadError(null);

    const viewer = new SkinViewer({
      canvas: canvasRef.current,
      width,
      height,
      pixelRatio: isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
      fov: 42,
      zoom: 0.86,
      enableControls: true,
    });

    viewer.controls.enableZoom = true;
    viewer.controls.enablePan = false;
    viewer.controls.enableDamping = !isSoftwareGl;
    viewer.controls.dampingFactor = 0.08;
    viewer.autoRotate = !prefersReducedMotion && !isSoftwareGl && autoRotate;
    viewer.autoRotateSpeed = 0.65;

    viewerRef.current = viewer;

    const mappedModel = skinModel === 'slim' ? 'slim' : 'default';
    viewer
      .loadSkin(skinUrl, { model: mappedModel })
      .then(() => {
        if (!viewer.disposed) {
          applyAnimation(viewer, prefersReducedMotion ? 'paused' : animMode);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!viewer.disposed) {
          setLoadError('Unable to load uploaded PNG skin texture.');
          setLoading(false);
        }
      });

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setLoadError('3D viewport paused due to WebGL context reset.');
    };
    const canvasEl = canvasRef.current;
    canvasEl.addEventListener('webglcontextlost', handleContextLost);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || viewer.disposed) return;
      const newWidth = Math.max(220, Math.floor(entry.contentRect.width));
      viewer.setSize(newWidth, height);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      canvasEl.removeEventListener('webglcontextlost', handleContextLost);
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [skinUrl, skinModel, height]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.disposed) return;
    applyAnimation(viewer, animMode);
  }, [animMode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.disposed) return;
    viewer.autoRotate = autoRotate;
  }, [autoRotate]);

  if (!skinUrl) {
    return (
      <div
        className={`flex flex-col items-center justify-center rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] px-6 text-center ${className}`}
        style={{ height }}
      >
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)] text-[var(--mc-accent)]">
          <User className="h-8 w-8" />
        </div>
        <p className="font-display text-base font-semibold text-[var(--mc-ink)]">{playerName}</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-[var(--mc-ink-muted)]">
          No 3D Minecraft skin uploaded yet. Only verified PNG skins uploaded by administrators are rendered here.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] ${className}`}
      style={{ height }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none cursor-grab active:cursor-grabbing"
        aria-label={`Interactive 3D Minecraft skin for ${playerName}`}
      />

      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--mc-loading-bg)]">
          <span className="text-xs font-medium text-[var(--mc-ink-muted)]">Loading 3D skin model...</span>
        </div>
      )}

      {loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--mc-surface-elevated)] p-6 text-center">
          <User className="mb-2 h-8 w-8 text-[var(--mc-accent)]" />
          <p className="text-sm font-medium text-[var(--mc-ink)]">{playerName}</p>
          <p className="mt-1 text-xs text-[var(--mc-ink-muted)]">{loadError}</p>
        </div>
      )}

      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--mc-border)] bg-[var(--mc-overlay-bg)] px-3 py-1.5">
        <span className="text-[11px] font-medium text-[var(--mc-ink-muted)]">
          Drag to rotate · {skinModel === 'slim' ? 'Slim' : 'Classic'} model
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAnimMode((prev) => (prev === 'idle' ? 'walk' : prev === 'walk' ? 'paused' : 'idle'))}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] px-2.5 text-xs font-medium text-[var(--mc-ink)] transition-colors hover:border-[var(--mc-accent-border)] whitespace-nowrap shrink-0"
          >
            {animMode === 'paused' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {animMode === 'idle' ? 'Idle' : animMode === 'walk' ? 'Walk' : 'Paused'}
          </button>
          <button
            type="button"
            onClick={() => setAutoRotate((v) => !v)}
            className={`inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              autoRotate
                ? 'border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)] text-[var(--mc-accent)]'
                : 'border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] text-[var(--mc-ink-muted)]'
            }`}
            title="Toggle auto-rotation"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Orbit
          </button>
          <button
            type="button"
            onClick={() => viewerRef.current?.resetCameraPose()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] text-[var(--mc-ink-muted)] transition-colors hover:text-[var(--mc-ink)]"
            title="Reset camera angle"
            aria-label="Reset camera angle"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
