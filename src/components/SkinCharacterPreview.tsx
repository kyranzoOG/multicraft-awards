import { useEffect, useRef, useState } from 'react';
import { Lock, User } from 'lucide-react';
import type { SkinModel } from '../types/awards';

interface SkinCharacterPreviewProps {
  skinUrl: string | null;
  skinModel?: SkinModel;
  name: string;
  sealed?: boolean;
  className?: string;
}

export function SkinCharacterPreview({
  skinUrl,
  skinModel = 'classic',
  name,
  sealed = false,
  className = '',
}: SkinCharacterPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!skinUrl || sealed) return;
    setFailed(false);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const scale = 6;
      const armW = skinModel === 'slim' ? 3 : 4;
      const totalW = 16;
      const totalH = 32;
      canvas.width = totalW * scale;
      canvas.height = totalH * scale;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;

      const is64x64 = img.height >= 64;
      const drawPart = (
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number
      ) => {
        ctx.drawImage(img, sx, sy, sw, sh, dx * scale, dy * scale, dw * scale, dh * scale);
      };

      // Head + Hat overlay
      drawPart(8, 8, 8, 8, 4, 0, 8, 8);
      drawPart(40, 8, 8, 8, 4, 0, 8, 8);

      // Torso + Jacket overlay
      drawPart(20, 20, 8, 12, 4, 8, 8, 12);
      if (is64x64) drawPart(20, 36, 8, 12, 4, 8, 8, 12);

      // Right Arm + Sleeve
      const rightArmX = skinModel === 'slim' ? 1 : 0;
      drawPart(44, 20, armW, 12, rightArmX, 8, armW, 12);
      if (is64x64) drawPart(44, 36, armW, 12, rightArmX, 8, armW, 12);

      // Left Arm + Sleeve
      if (is64x64) {
        drawPart(36, 52, armW, 12, 12, 8, armW, 12);
        drawPart(52, 52, armW, 12, 12, 8, armW, 12);
      } else {
        drawPart(44, 20, armW, 12, 12, 8, armW, 12);
      }

      // Right Leg + Pants
      drawPart(4, 20, 4, 12, 4, 20, 4, 12);
      if (is64x64) drawPart(4, 36, 4, 12, 4, 20, 4, 12);

      // Left Leg + Pants
      if (is64x64) {
        drawPart(20, 52, 4, 12, 8, 20, 4, 12);
        drawPart(4, 52, 4, 12, 8, 20, 4, 12);
      } else {
        drawPart(4, 20, 4, 12, 8, 20, 4, 12);
      }
    };
    img.onerror = () => setFailed(true);
    img.src = skinUrl;
  }, [skinUrl, skinModel, sealed]);

  if (sealed) {
    return (
      <div
        className={`flex h-28 w-full items-center justify-center rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] ${className}`}
      >
        <Lock className="h-6 w-6 text-[var(--mc-ink-subtle)]" />
      </div>
    );
  }

  if (!skinUrl || failed) {
    return (
      <div
        className={`flex h-28 w-full flex-col items-center justify-center rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] ${className}`}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--mc-accent-border)] bg-[var(--mc-accent-soft)] font-display text-sm font-bold text-[var(--mc-accent)]">
          {name ? name.slice(0, 2).toUpperCase() : <User className="h-5 w-5" />}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-28 w-full items-center justify-center rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface-elevated)] py-2 ${className}`}
    >
      <canvas
        ref={canvasRef}
        aria-label={`${name} Minecraft character`}
        className="h-24 w-auto object-contain"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}
