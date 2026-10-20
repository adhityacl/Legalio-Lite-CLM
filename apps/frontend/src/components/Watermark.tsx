import React from 'react';

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Tiled, click-through "organization · email · date" overlay (tenant `watermark` module). */
export const Watermark: React.FC<{ text: string }> = ({ text }) => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='420'><text x='210' y='210' text-anchor='middle' transform='rotate(-30 210 210)' font-family='sans-serif' font-size='14' fill='#888' fill-opacity='0.18'>${xmlEscape(text)}</text></svg>`;
  return (
    <div
      aria-hidden="true"
      data-testid="page-watermark"
      className="pointer-events-none fixed inset-0 z-[9999]"
      style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")` }}
    />
  );
};
