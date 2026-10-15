import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from './utils';

/**
 * Animated sky background (WebGL), one preset per time of day. Fills its positioned parent.
 * Falls back to a static gradient from the same palette when WebGL is unavailable, the tab is hidden,
 * the element is off screen or the user prefers reduced motion.
 */
type Rgb = [number, number, number];
type Preset = { main: Rgb; low: Rgb; mid: Rgb; high: Rgb; speed: number; start: number; scale: number; distortion: number; swirl: number; grain: number };

export const SKY_PRESETS = {
  /** Morning to early afternoon. */
  day: { main: [0.7019607843137255, 0.8509803921568627, 1], low: [0.4, 0.6, 0.9019607843137255], mid: [0.5019607843137255, 0.7019607843137254, 1], high: [0.9019607843137255, 0.9490196078431372, 1], speed: 22, start: 33.6651788, scale: 45, distortion: 50, swirl: 40, grain: 4 },
  /** Late afternoon. */
  sunset: { main: [1, 0.9529411764705882, 0.8392156862745098], low: [1, 0.6823529411764706, 0.4], mid: [1, 0.8509803921568627, 0.6274509803921569], high: [0.9725490196078431, 0.9568627450980393, 0.9019607843137255], speed: 18, start: 42.479318, scale: 45, distortion: 54, swirl: 34, grain: 5 },
  night: { main: [0.43137254901960786, 0.4980392156862745, 0.7490196078431373], low: [0.2, 0.25098039215686274, 0.43137254901960786], mid: [0.2901960784313726, 0.35294117647058826, 0.6274509803921569], high: [0.7254901960784313, 0.7843137254901961, 0.9490196078431372], speed: 14, start: 47.598016, scale: 42, distortion: 46, swirl: 28, grain: 8 },
} satisfies Record<string, Preset>;

export type SkyPeriod = keyof typeof SKY_PRESETS;

/** Theme palettes only change colour; each period keeps its original motion settings. */
const SKY_COLORS: Record<'light' | 'dark', Record<SkyPeriod, Pick<Preset, 'main' | 'low' | 'mid' | 'high'>>> = {
  light: {
    day: { main: [0.82, 0.91, 1], low: [0.65, 0.80, 0.98], mid: [0.75, 0.87, 1], high: [0.96, 0.98, 1] },
    sunset: { main: [1, 0.93, 0.86], low: [0.96, 0.77, 0.65], mid: [1, 0.86, 0.77], high: [1, 0.98, 0.93] },
    night: { main: [0.86, 0.87, 1], low: [0.72, 0.76, 0.96], mid: [0.81, 0.83, 1], high: [0.97, 0.97, 1] },
  },
  dark: {
    day: { main: [0.16, 0.24, 0.38], low: [0.08, 0.13, 0.24], mid: [0.22, 0.34, 0.50], high: [0.40, 0.55, 0.70] },
    sunset: { main: [0.28, 0.20, 0.30], low: [0.14, 0.10, 0.20], mid: [0.40, 0.28, 0.35], high: [0.62, 0.45, 0.43] },
    night: { main: [0.20, 0.24, 0.40], low: [0.08, 0.11, 0.22], mid: [0.27, 0.32, 0.51], high: [0.47, 0.54, 0.73] },
  },
};

/** Text colour and a bottom scrim (keeps AA contrast over bright clouds) per sky. Fixed on purpose: tenant theme tokens (e.g. a light primary) can leave dark text on a dark sky. */
export const SKY_INK = {
  day: { color: 'rgb(255 255 255)', textShadow: '0 1px 3px rgb(0 0 0 / 0.45)', scrim: 'rgb(0 0 0 / 0.6)' },
  sunset: { color: 'rgb(23 32 51)', textShadow: 'none', scrim: 'rgb(255 255 255 / 0.65)' },
  night: { color: 'rgb(255 255 255)', textShadow: '0 1px 3px rgb(0 0 0 / 0.45)', scrim: 'rgb(0 0 0 / 0.6)' },
} satisfies Record<SkyPeriod, { color: string; textShadow: string; scrim: string }>;

/** Same hour bands as the dashboard greeting: 05-15 day, 15-18 sunset, otherwise night. */
export const skyPeriodAt = (hour: number): SkyPeriod => (hour >= 5 && hour < 15 ? 'day' : hour >= 15 && hour < 18 ? 'sunset' : 'night');

const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FRAGMENT = `precision highp float;
uniform vec2 u_res;
uniform float u_t;
uniform vec3 u_main;
uniform vec3 u_low;
uniform vec3 u_mid;
uniform vec3 u_high;
uniform float u_wind;
uniform float u_warp;
uniform float u_nscale;
uniform sampler2D u_noise;

const float FBM_STRENGTH = 0.912;
const float BLUR_RADIUS = 1.2673;
const float ZOOM = 0.3971;
const float GRAIN_SCALE = 2.5;
const float GRAIN_STRENGTH = 0.014;

vec3 burn(vec3 base, vec3 blend, float op){
  return max(base + blend - vec3(1.0), vec3(0.0))*op + base*(1.0-op);
}
float rand2(vec2 n){ return fract(sin(dot(n, vec2(12.9898, 4.1414)))*43758.5453); }
float noise2(vec2 p){
  vec2 ip = floor(p); vec2 u = fract(p);
  u = u*u*(3.0-2.0*u);
  float m = mix(mix(rand2(ip), rand2(ip+vec2(1.,0.)), u.x), mix(rand2(ip+vec2(0.,1.)), rand2(ip+vec2(1.,1.)), u.x), u.y);
  return m*m;
}
float fbm4(vec2 x){
  float v = 0.0; float a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 4; i++) { v += a*noise2(x); x = rot*x*2.0 + shift; a *= 0.5; }
  return v;
}
vec4 permute4(vec4 x){ return mod((x*34.0 + 1.0)*x, 289.0); }
vec4 tisqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314*r; }
vec3 fade3(vec3 t){ return t*t*t*(t*(t*6.0-15.0)+10.0); }
float cnoise(vec3 P){
  vec3 Pi0 = floor(P); vec3 Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod(Pi0, 289.0); Pi1 = mod(Pi1, 289.0);
  vec3 Pf0 = fract(P); vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = vec4(Pi0.z); vec4 iz1 = vec4(Pi1.z);
  vec4 ixy = permute4(permute4(ix) + iy);
  vec4 ixy0 = permute4(ixy + iz0); vec4 ixy1 = permute4(ixy + iz1);
  vec4 gx0 = ixy0/7.0; vec4 gy0 = fract(floor(gx0)/7.0) - 0.5; gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0); vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0*(step(vec4(0.0), gx0) - 0.5); gy0 -= sz0*(step(vec4(0.0), gy0) - 0.5);
  vec4 gx1 = ixy1/7.0; vec4 gy1 = fract(floor(gx1)/7.0) - 0.5; gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1); vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1*(step(vec4(0.0), gx1) - 0.5); gy1 -= sz1*(step(vec4(0.0), gy1) - 0.5);
  vec3 g000 = vec3(gx0.x, gy0.x, gz0.x); vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
  vec3 g010 = vec3(gx0.z, gy0.z, gz0.z); vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
  vec3 g001 = vec3(gx1.x, gy1.x, gz1.x); vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
  vec3 g011 = vec3(gx1.z, gy1.z, gz1.z); vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);
  vec4 n0 = tisqrt(vec4(dot(g000,g000), dot(g010,g010), dot(g100,g100), dot(g110,g110)));
  g000 *= n0.x; g010 *= n0.y; g100 *= n0.z; g110 *= n0.w;
  vec4 n1 = tisqrt(vec4(dot(g001,g001), dot(g011,g011), dot(g101,g101), dot(g111,g111)));
  g001 *= n1.x; g011 *= n1.y; g101 *= n1.z; g111 *= n1.w;
  float n000 = dot(g000, Pf0); float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z)); float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z)); float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz)); float n111 = dot(g111, Pf1);
  vec3 fx = fade3(Pf0);
  vec4 nz = mix(vec4(n000,n100,n010,n110), vec4(n001,n101,n011,n111), fx.z);
  vec2 ny = mix(nz.xy, nz.zw, fx.y);
  return 2.2*mix(ny.x, ny.y, fx.x);
}
void main(){
  vec2 st = gl_FragCoord.xy/u_res - 0.5;
  st.x *= u_res.x/u_res.y;
  float time = u_t*0.85;
  vec2 uv = st*(1.0/(2.0*ZOOM)) + 0.5;
  float noiseX = cnoise(vec3(uv*u_nscale + vec2(0.0, 74.8572), time*0.3));
  float noiseY = cnoise(vec3(uv*u_nscale + vec2(203.91282, 10.0), time*0.3));
  uv += vec2(noiseX*2.0, noiseY)*u_warp;
  float noiseA = cnoise(vec3(uv*18.0 + vec2(344.91282, 0.0), time*0.3))
               + cnoise(vec3(uv*39.6 + vec2(723.937, 0.0), time*0.4))*0.5;
  uv += noiseA*0.02;
  uv.y -= 0.09;
  float xf = (sin(time) + 1.0)*0.5;
  vec2 texUv = uv*GRAIN_SCALE;
  float d0 = mix(texture2D(u_noise, texUv).r - 0.5, texture2D(u_noise, vec2(texUv.x, 1.0-texUv.y)).g - 0.5, xf)*GRAIN_STRENGTH;
  texUv += vec2(63.861, 368.937);
  float d1 = mix(texture2D(u_noise, texUv).r - 0.5, texture2D(u_noise, vec2(texUv.x, 1.0-texUv.y)).g - 0.5, xf)*GRAIN_STRENGTH;
  texUv += vec2(453.163, 1649.808);
  float d3 = mix(texture2D(u_noise, texUv).r - 0.5, texture2D(u_noise, vec2(texUv.x, 1.0-texUv.y)).g - 0.5, xf)*GRAIN_STRENGTH;
  uv += d0;
  vec2 stF = uv*u_nscale;
  vec2 q = vec2(fbm4(stF*0.5 + u_wind*time));
  vec2 r = vec2(fbm4(stF + q + vec2(0.3, 9.2) + 0.15*time), fbm4(stF + q + vec2(8.3, 0.8) + 0.126*time));
  float fv = fbm4(stF + r - q);
  float full = (fv + 0.6*fv*fv + 0.7*fv + 0.5)*0.5;
  full = pow(full, 0.55)*FBM_STRENGTH;
  float blurR = BLUR_RADIUS*1.5;
  vec2 uvA = uv + vec2((full-0.5)*1.2) + vec2(0.0, 0.025) + d0;
  float snA = noise2(uvA*2.0 + vec2(0.0, time*0.5))*3.0;
  float lA = pow(smoothstep(snA - 1.2*blurR, snA + 1.2*blurR, (uvA.y - 0.5)*5.0 + 0.5), 0.8);
  vec2 uvB = uv + vec2((full-0.5)*0.85) + vec2(0.0, 0.025) + d1;
  float snB = noise2(uvB*4.0 + vec2(293.0, time))*2.8;
  float lB = pow(smoothstep(snB - 0.9*blurR, snB + 0.9*blurR, (uvB.y - 0.6)*5.0 + 0.5), 0.9);
  vec2 uvC = uv + vec2((full-0.5)*1.1) + d3;
  float snC = noise2(uvC*6.0 + vec2(153.0, time*1.2))*2.6;
  float lC = smoothstep(snC - 0.7*blurR, snC + 0.7*blurR, (uvC.y - 0.9)*6.0 + 0.5);
  vec3 col = burn(u_main, u_low, 1.0 - lA);
  col = burn(col, mix(u_main, u_mid, 1.0 - lB), lA);
  col = mix(col, mix(u_main, u_high, 1.0 - lC), lA*lB);
  gl_FragColor = vec4(col, 1.0);
}`;

const FLOW_SPEED_RATE = 1.2;
const MAX_WIDTH = 2560;
const css = ([r, g, b]: Rgb) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

function compile(gl: WebGLRenderingContext, kind: number, source: string) {
  const shader = gl.createShader(kind);
  if (!shader) throw new Error('Could not create the sky shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Sky shader failed to compile.';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

export function SkyGradient({ period, colorScheme, className }: { period: SkyPeriod; colorScheme?: 'light' | 'dark'; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const preset: Preset = useMemo(() => ({ ...SKY_PRESETS[period], ...(colorScheme ? SKY_COLORS[colorScheme][period] : {}) }), [period, colorScheme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) { setFailed(true); return; }

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, last = 0, t = preset.start, visible = true, lost = false, disposed = false;
    let program: WebGLProgram | null = null, resolution: WebGLUniformLocation | null = null, time: WebGLUniformLocation | null = null;

    try {
      const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
      program = gl.createProgram();
      if (!program) throw new Error('Could not create the sky program.');
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.bindAttribLocation(program, 0, 'p');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Sky program failed to link.');
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      const noise = new Uint8Array(256 * 256 * 4);
      for (let i = 0; i < 256 * 256; i++) {
        const value = (Math.random() * 256) | 0;
        noise.set([value, value, value, 255], i * 4);
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, noise);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1i(gl.getUniformLocation(program, 'u_noise'), 0);
      gl.uniform3fv(gl.getUniformLocation(program, 'u_main'), preset.main);
      gl.uniform3fv(gl.getUniformLocation(program, 'u_low'), preset.low);
      gl.uniform3fv(gl.getUniformLocation(program, 'u_mid'), preset.mid);
      gl.uniform3fv(gl.getUniformLocation(program, 'u_high'), preset.high);
      gl.uniform1f(gl.getUniformLocation(program, 'u_nscale'), 0.35 + preset.scale / 100 * 1.15);
      gl.uniform1f(gl.getUniformLocation(program, 'u_warp'), preset.distortion / 100 * 0.47);
      gl.uniform1f(gl.getUniformLocation(program, 'u_wind'), preset.swirl / 100 * 0.36);
      resolution = gl.getUniformLocation(program, 'u_res');
      time = gl.getUniformLocation(program, 'u_t');
    } catch (error) {
      console.warn('Sky WebGL unavailable:', error);
      setFailed(true);
      return;
    }

    const paint = () => {
      if (lost || disposed || canvas.width < 1 || canvas.height < 1) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform1f(time, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const active = () => !disposed && !lost && visible && !document.hidden && !motion.matches;
    const tick = (now: number) => {
      frame = 0;
      if (!active()) { last = 0; return; }
      if (last) t += Math.min(0.05, (now - last) / 1000) * (preset.speed / 100) * FLOW_SPEED_RATE;
      last = now;
      paint();
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      if (!active()) { if (frame) cancelAnimationFrame(frame); frame = 0; last = 0; paint(); }
      else if (!frame) { last = 0; paint(); frame = requestAnimationFrame(tick); }
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const scale = Math.min(1, MAX_WIDTH / Math.max(1, rect.width * dpr));
      canvas.width = Math.max(1, Math.round(rect.width * dpr * scale));
      canvas.height = Math.max(1, Math.round(rect.height * dpr * scale));
      paint();
    };
    const onLost = (event: Event) => { event.preventDefault(); lost = true; setFailed(true); };

    canvas.addEventListener('webglcontextlost', onLost);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    intersection.observe(canvas);
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    resize();
    sync();

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', sync);
      motion.removeEventListener('change', sync);
      canvas.removeEventListener('webglcontextlost', onLost);
    };
  }, [preset]);

  return (
    <div
      aria-hidden="true"
      className={cn('absolute inset-0 overflow-hidden', className)}
      style={{ background: `linear-gradient(180deg, ${css(preset.high)}, ${css(preset.mid)}, ${css(preset.main)}, ${css(preset.low)})` }}
    >
      {!failed && <canvas ref={canvasRef} className="absolute inset-0 size-full" />}
    </div>
  );
}
