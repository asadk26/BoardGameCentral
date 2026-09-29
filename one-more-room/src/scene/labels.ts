// Text drawn onto canvas textures, so labels need no font downloads and
// never interpret custom text as markup.

import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

export interface LabelStyle {
  bg?: string;
  fg?: string;
  border?: string;
  font?: string;
  padX?: number;
  height?: number;
  radius?: number;
}

export function labelTexture(lines: string[], style: LabelStyle = {}): { tex: THREE.CanvasTexture; aspect: number } {
  const key = JSON.stringify([lines, style]);
  let tex = cache.get(key);
  const h = style.height ?? 96;
  const font = style.font ?? `700 ${Math.round(h * 0.42)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  if (!tex) {
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = font;
    const padX = style.padX ?? h * 0.35;
    const w = Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width)) + padX * 2);
    const lineH = h * 0.5;
    const H = Math.ceil(lines.length === 1 ? h : h * 0.3 + lineH * lines.length);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(w, H);
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const r = style.radius ?? H * 0.3;
    ctx.beginPath();
    ctx.roundRect(3, 3, canvas.width - 6, H - 6, r);
    ctx.fillStyle = style.bg ?? 'rgba(24, 14, 38, 0.86)';
    ctx.fill();
    if (style.border) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = style.border;
      ctx.stroke();
    }
    ctx.fillStyle = style.fg ?? '#fff3d6';
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => {
      const y = lines.length === 1 ? H / 2 : h * 0.15 + lineH * (i + 0.5);
      ctx.fillText(l, canvas.width / 2, y + 2);
    });
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    cache.set(key, tex);
    if (cache.size > 300) {
      const first = cache.keys().next().value as string;
      cache.get(first)?.dispose();
      cache.delete(first);
    }
  }
  const img = tex.image as HTMLCanvasElement;
  return { tex, aspect: img.width / img.height };
}

/** A round badge with a number or letter, for bases and passages. */
export function badgeTexture(text: string, bg: string, fg = '#1a1024', ring = '#fff6e0'): THREE.CanvasTexture {
  const key = `badge:${text}:${bg}:${fg}:${ring}`;
  let tex = cache.get(key);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fillStyle = ring;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(64, 64, 51, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.font = '800 72px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 69);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    cache.set(key, tex);
  }
  return tex;
}

/** Symbols painted on tiles: the hall's crest, a keyhole for passages. */
export function tileSymbolTexture(kind: 'secretA' | 'secretB' | 'entrance'): THREE.CanvasTexture {
  const key = `tile:${kind}`;
  let tex = cache.get(key);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 256);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (kind === 'entrance') {
      ctx.strokeStyle = '#3a2008';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(128, 128, 100, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#3a2008';
      ctx.font = '800 40px system-ui, sans-serif';
      ctx.fillText('ENTRANCE', 128, 110);
      ctx.fillText('HALL', 128, 158);
    } else {
      ctx.fillStyle = '#f6eaff';
      ctx.beginPath();
      ctx.arc(128, 96, 42, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(100, 120);
      ctx.lineTo(156, 120);
      ctx.lineTo(142, 200);
      ctx.lineTo(114, 200);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2a0b3a';
      ctx.font = '900 64px system-ui, sans-serif';
      ctx.fillText(kind === 'secretA' ? 'A' : 'B', 128, 104);
    }
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    cache.set(key, tex);
  }
  return tex;
}
